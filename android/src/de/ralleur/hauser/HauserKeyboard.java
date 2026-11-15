// SPDX-License-Identifier: AGPL-3.0-only
package de.ralleur.hauser;

import android.inputmethodservice.InputMethodService;
import android.graphics.Color;
import android.graphics.Rect;
import android.graphics.PixelFormat;
import android.graphics.drawable.ColorDrawable;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.view.*;
import android.view.inputmethod.*;
import android.webkit.*;
import android.widget.FrameLayout;
import org.json.JSONObject;

/** Local QWERTZ IME. No network, telemetry, stored input or third-party keyboard SDK. */
public final class HauserKeyboard extends InputMethodService {
    private WebView web;
    private final Rect keyboardBounds=new Rect();
    private final Handler handler=new Handler(Looper.getMainLooper());
    private boolean ready,password;
    @Override public void onCreate(){setTheme(android.R.style.Theme_DeviceDefault_InputMethod);WebView.setDataDirectorySuffix("hauser-keyboard");WebView.setWebContentsDebuggingEnabled(BuildConfig.PROTOTYPE);super.onCreate();}
    @Override public View onCreateInputView(){
        web=LocalSurface.create(this,"Keyboard",new Bridge());
        int id=getResources().getIdentifier(getResources().getConfiguration().orientation==2?"tablet_keyboard_landscape_height":"tablet_keyboard_portrait_height","dimen",getPackageName());
        FrameLayout container=new FrameLayout(this);container.addView(web,new FrameLayout.LayoutParams(-1,getResources().getDimensionPixelSize(id)));
        container.setOnApplyWindowInsetsListener((view,insets)->{android.graphics.Insets bars=insets.getInsets(WindowInsets.Type.navigationBars());view.setPadding(bars.left,0,bars.right,bars.bottom);return new WindowInsets.Builder(insets).setInsets(WindowInsets.Type.navigationBars(),android.graphics.Insets.NONE).build();});
        container.requestApplyInsets();
        web.loadUrl(LocalSurface.ORIGIN+"/keyboard.html");return container;
    }
    @Override public boolean onEvaluateFullscreenMode(){return false;}
    @Override public void onStartInput(EditorInfo info,boolean restarting){super.onStartInput(info,restarting);int variation=info.inputType&InputType.TYPE_MASK_VARIATION;password=(info.inputType&InputType.TYPE_MASK_CLASS)==InputType.TYPE_CLASS_NUMBER?variation==InputType.TYPE_NUMBER_VARIATION_PASSWORD:variation==InputType.TYPE_TEXT_VARIATION_PASSWORD||variation==InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD||variation==InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD;}
    @Override public void onStartInputView(EditorInfo info,boolean restarting){super.onStartInputView(info,restarting);floatingWindow();configure();}
    private void floatingWindow(){
        Window window=getWindow().getWindow();
        window.setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
        window.setFormat(PixelFormat.TRANSLUCENT);
        window.clearFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND|WindowManager.LayoutParams.FLAG_TRANSLUCENT_NAVIGATION);
        window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        window.setNavigationBarColor(Color.TRANSPARENT);
        window.setNavigationBarContrastEnforced(false);
        // The framework's input-area background otherwise paints a full-width strip.
        for(View view=web;view!=null;){view.setBackgroundColor(Color.TRANSPARENT);ViewParent parent=view.getParent();view=parent instanceof View?(View)parent:null;}
    }
    @Override public void onComputeInsets(Insets insets){
        // A floating keyboard overlays the app; it does not reserve a bottom band.
        int height=getWindow().getWindow().getDecorView().getHeight();
        insets.contentTopInsets=height;insets.visibleTopInsets=height;
        insets.touchableInsets=Insets.TOUCHABLE_INSETS_REGION;
        insets.touchableRegion.setEmpty();
        if(web!=null&&!keyboardBounds.isEmpty()){
            int[] origin=new int[2];web.getLocationInWindow(origin);
            Rect bounds=new Rect(keyboardBounds);bounds.offset(origin[0],origin[1]);insets.touchableRegion.set(bounds);
        }
    }
    @Override public void onUpdateSelection(int os,int oe,int ns,int ne,int cs,int ce){super.onUpdateSelection(os,oe,ns,ne,cs,ce);suggest();}
    @Override public void onFinishInput(){if(web!=null&&ready)web.evaluateJavascript("window.clearInput()",null);super.onFinishInput();}
    private void configure(){if(!ready)return;EditorInfo info=getCurrentInputEditorInfo();if(info==null)return;JSONObject data=new JSONObject();try{data.put("password",password).put("type",info.inputType&InputType.TYPE_MASK_CLASS).put("action",info.imeOptions&EditorInfo.IME_MASK_ACTION);}catch(Exception ignored){}web.evaluateJavascript("window.configure("+data+")",null);suggest();}
    private void suggest(){if(!ready||web==null)return;InputConnection c=getCurrentInputConnection();String prefix="";if(c!=null&&!password){CharSequence before=c.getTextBeforeCursor(48,0);if(before!=null){String s=before.toString();java.util.regex.Matcher match=java.util.regex.Pattern.compile("[\\p{L}]+$").matcher(s);if(match.find())prefix=match.group();}}web.evaluateJavascript("window.suggest("+JSONObject.quote(prefix)+")",null);}
    public final class Bridge {
        @JavascriptInterface public void bounds(String raw){if(raw==null||raw.length()>512)return;handler.post(()->{try{
            JSONObject box=new JSONObject(raw);double width=box.getDouble("width");if(width<=0||web==null)return;
            double scale=web.getWidth()/width;
            Rect next=new Rect((int)Math.floor(box.getDouble("left")*scale),(int)Math.floor(box.getDouble("top")*scale),(int)Math.ceil(box.getDouble("right")*scale),(int)Math.ceil(box.getDouble("bottom")*scale));
            if(!keyboardBounds.equals(next)){keyboardBounds.set(next);web.getRootView().requestLayout();}
        }catch(Exception ignored){}});}
        @JavascriptInterface public void ready(){handler.post(()->{ready=true;configure();});}
        @JavascriptInterface public void key(String action,String value){if(value==null||value.length()>128)return;handler.post(()->{
            InputConnection c=getCurrentInputConnection();if(c==null)return;
            switch(action){
                case "text":c.commitText(value,1);break;
                case "delete":CharSequence selected=c.getSelectedText(0);if(selected!=null&&selected.length()>0)c.commitText("",1);else{CharSequence previous=c.getTextBeforeCursor(64,0);if(previous!=null&&previous.length()>0){android.icu.text.BreakIterator graphemes=android.icu.text.BreakIterator.getCharacterInstance();graphemes.setText(previous.toString());int start=graphemes.preceding(previous.length());c.deleteSurroundingText(previous.length()-Math.max(0,start),0);}}break;
                case "suggest":if(password)return;CharSequence before=c.getTextBeforeCursor(48,0);if(before!=null){java.util.regex.Matcher m=java.util.regex.Pattern.compile("[\\p{L}]+$").matcher(before);if(m.find()){c.beginBatchEdit();c.deleteSurroundingText(m.group().length(),0);c.commitText(value+" ",1);c.endBatchEdit();}}break;
                case "enter":EditorInfo info=getCurrentInputEditorInfo();int editorAction=info==null?EditorInfo.IME_ACTION_NONE:info.imeOptions&EditorInfo.IME_MASK_ACTION;
                    if(editorAction!=EditorInfo.IME_ACTION_NONE&&editorAction!=EditorInfo.IME_ACTION_UNSPECIFIED)c.performEditorAction(editorAction);else c.commitText("\n",1);break;
                case "hide":requestHideSelf(0);break;
            }suggest();
        });}
    }
    @Override public void onDestroy(){handler.removeCallbacksAndMessages(null);if(web!=null){web.removeJavascriptInterface("Keyboard");web.destroy();}super.onDestroy();}
}
