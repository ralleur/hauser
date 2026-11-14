// SPDX-License-Identifier: AGPL-3.0-only
package de.ralleur.hauser;

import android.app.*;
import android.content.*;
import android.graphics.*;
import android.net.Uri;
import android.net.http.SslError;
import android.os.*;
import android.security.keystore.*;
import android.util.Base64;
import android.view.*;
import android.webkit.*;
import android.widget.*;
import org.json.*;
import java.io.*;
import java.net.URL;
import java.net.HttpURLConnection;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.*;
import java.util.concurrent.*;
import javax.crypto.*;
import javax.crypto.spec.GCMParameterSpec;
import com.google.zxing.*;
import com.google.zxing.common.HybridBinarizer;

/** Public companion: local iPhone-derived onboarding, then the user's existing server UI. */
public final class MainActivity extends Activity {
    private static final String LOCAL="https://hauser-onboarding.invalid", COOKIE="hauser_device_session";
    private static final int PICK=73, SCAN=74;
    private final ExecutorService work=Executors.newSingleThreadExecutor();
    private WebView web; private FrameLayout root; private boolean onboarding, errorVisible, destroyed;
    private JSONObject pairing; private String base="", pendingLink, pickerOrigin;
    private ValueCallback<Uri[]> fileCallback;
    private View customView; private WebChromeClient.CustomViewCallback customCallback;
    private boolean german(){return Locale.getDefault().getLanguage().equals("de");}
    private String t(String de,String en){return german()?de:en;}

    @Override public void onCreate(Bundle saved){
        super.onCreate(saved); getWindow().setDecorFitsSystemWindows(false);
        pendingLink=getIntent().getDataString();
        try{pairing=readPairing();}catch(Exception ignored){}
        if(pairing==null || pendingLink!=null) showOnboarding(); else connect();
    }
    private void layout(WebView next){
        if(web!=null){web.removeJavascriptInterface("HauserSetup");web.stopLoading();web.destroy();}
        web=next; root=new FrameLayout(this);root.addView(web,new FrameLayout.LayoutParams(-1,-1));
        root.setOnApplyWindowInsetsListener((v,insets)->{
            int bars=getPreferences(0).getBoolean("fullscreen",true)?WindowInsets.Type.navigationBars():WindowInsets.Type.systemBars();
            android.graphics.Insets b=insets.getInsets(bars|WindowInsets.Type.ime()|WindowInsets.Type.displayCutout());
            v.setPadding(b.left,b.top,b.right,b.bottom);
            return new WindowInsets.Builder(insets).setInsets(WindowInsets.Type.systemBars()|WindowInsets.Type.ime()|WindowInsets.Type.displayCutout(),android.graphics.Insets.NONE)
                .setInsetsIgnoringVisibility(WindowInsets.Type.systemBars()|WindowInsets.Type.displayCutout(),android.graphics.Insets.NONE).setDisplayCutout(null).build();
        });
        setContentView(root);root.requestApplyInsets();bars();
    }
    private void bars(){WindowInsetsController c=getWindow().getInsetsController();if(c!=null){
        c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        boolean full=getPreferences(0).getBoolean("fullscreen",true);
        if(full)c.hide(WindowInsets.Type.statusBars());else c.show(WindowInsets.Type.statusBars());
    }}
    private WebView newWeb(){
        WebView v=new WebView(this); WebSettings s=v.getSettings();s.setJavaScriptEnabled(true);s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);s.setAllowContentAccess(true);s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setMediaPlaybackRequiresUserGesture(true);s.setSupportMultipleWindows(false);s.setSafeBrowsingEnabled(true);
        WebView.setWebContentsDebuggingEnabled(false);CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(v,false);
        v.setWebChromeClient(new WebChromeClient(){
            public void onPermissionRequest(PermissionRequest r){r.deny();}
            public boolean onShowFileChooser(WebView view,ValueCallback<Uri[]> callback,FileChooserParams params){
                if(onboarding||!ServerAddress.same(base,view.getUrl()))return false;
                if(fileCallback!=null)fileCallback.onReceiveValue(null);
                fileCallback=callback;pickerOrigin=base;
                Intent i=new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
                String[] types=params.getAcceptTypes();
                if(types.length>0&&!types[0].isEmpty())i.putExtra(Intent.EXTRA_MIME_TYPES,types);
                i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE,params.getMode()==FileChooserParams.MODE_OPEN_MULTIPLE);
                try{startActivityForResult(i,PICK);}catch(ActivityNotFoundException e){finishPicker(null);}return true;
            }
            public void onShowCustomView(View v,CustomViewCallback callback){if(customView!=null){callback.onCustomViewHidden();return;}customView=v;customCallback=callback;root.addView(v,new FrameLayout.LayoutParams(-1,-1));}
            public void onHideCustomView(){hideCustom();}
        });return v;
    }
    private void showOnboarding(){
        onboarding=true; WebView v=newWeb();v.addJavascriptInterface(new SetupBridge(),"HauserSetup");
        v.setWebViewClient(new WebViewClient(){
            public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest r){
                if(!ServerAddress.same(LOCAL,r.getUrl().toString()))return blocked();
                String path=r.getUrl().getPath();if(path.equals("/"))path="index.html";else path=path.substring(1);
                if(path.contains(".."))return blocked();
                try{String mime=path.endsWith(".html")?"text/html":path.endsWith(".js")?"text/javascript":path.endsWith(".css")?"text/css":path.endsWith(".avif")?"image/avif":path.endsWith(".svg")?"image/svg+xml":path.endsWith(".woff2")?"font/woff2":"text/plain";
                    return new WebResourceResponse(mime,"utf-8",getAssets().open(path));}catch(Exception e){return blocked();}
            }
            public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest r){return !ServerAddress.same(LOCAL,r.getUrl().toString());}
            public void onPageFinished(WebView view,String url){
                if(pendingLink!=null){String link=pendingLink;pendingLink=null;handleLink(link);}
            }
        });layout(v);web.loadUrl(LOCAL+"/");
    }
    private WebResourceResponse blocked(){return new WebResourceResponse("text/plain","utf-8",403,"Blocked",Collections.emptyMap(),new ByteArrayInputStream(new byte[0]));}
    private void callback(JSONObject value){runOnUiThread(()->{if(!destroyed&&onboarding)web.evaluateJavascript("window.nativeResult("+value.toString()+")",null);});}
    private JSONObject result(String type,String message){JSONObject r=new JSONObject();try{r.put("type",type).put("message",message);}catch(Exception ignored){}return r;}
    private void fail(Exception e){String msg=e instanceof ApiFailure?e.getMessage():t("Hauser ist nicht erreichbar. Prüfe Adresse, Heimnetz und Zertifikat.","Hauser is unreachable. Check the address, home network and certificate.");callback(result("error",msg));}
    public final class SetupBridge{
        @JavascriptInterface public void discover(String typed){work.execute(()->{
            List<String> list=new ArrayList<>();if(!typed.trim().isEmpty())list.add(typed);list.add("http://homeassistant.local:4173");list.add("http://homeassistant:4173");
            for(String raw:list){String b=ServerAddress.normalize(raw);if(b==null)continue;
                try{JSONObject health=request(b,"GET","/api/health",null,null,2500);if(!health.has("ok")&&!health.has("status"))continue;
                    JSONObject r=result("found",b);r.put("address",b);callback(r);return;}catch(Exception ignored){}
            }callback(result("missing",t("Im Heimnetz meldet sich noch kein Hauser — mit dem Code klappt es trotzdem.","No Hauser is answering on your network yet — the code still works.")));
        });}
        @JavascriptInterface public void claim(String address,String code,String name,boolean allowHttp,String remote){
            work.execute(()->claimServer(address,code,name,remote.isEmpty()?null:remote,allowHttp));
        }
        @JavascriptInterface public void person(String id){work.execute(()->{
            if(pairing==null)return;
            try{if(!id.isEmpty()){JSONObject p=new JSONObject().put("person",id);request(pairing.getString("lan"),"PATCH","/api/pairing/devices/"+pairing.getString("deviceId"),p,pairing.getString("token"),8000);}
                savePairing(pairing);runOnUiThread(()->connect());}catch(Exception e){fail(e);}
        });}
        @JavascriptInterface public void scan(){runOnUiThread(()->{
            Uri uri=Uri.parse("content://de.ralleur.hauser.capture/qr.jpg");
            Intent i=new Intent(android.provider.MediaStore.ACTION_IMAGE_CAPTURE).putExtra(android.provider.MediaStore.EXTRA_OUTPUT,uri)
                .addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION|Intent.FLAG_GRANT_READ_URI_PERMISSION);
            i.setClipData(ClipData.newRawUri("QR",uri));
            try{startActivityForResult(i,SCAN);}catch(ActivityNotFoundException e){callback(result("error",t("Keine Kamera-App verfügbar. Bitte Adresse und Code eingeben.","No camera app available. Enter the address and code instead.")));}
        });}
        @JavascriptInterface public void demo(){runOnUiThread(()->{pairing=null;base="https://hauserhome.app";showServer(base+"/demo/");});}
        @JavascriptInterface public void external(String url){runOnUiThread(()->{
            if(url.equals("https://github.com/ralleur/hauser")||url.startsWith("https://my.home-assistant.io/redirect/supervisor_"))externalUrl(Uri.parse(url));
        });}
    }
    private void claimServer(String raw,String code,String name,String remote,boolean allowHttp){
        try{String lan=ServerAddress.normalize(raw);code=code.trim().toUpperCase(Locale.ROOT);
            if(lan==null||!code.matches("[A-HJKMNP-Z2-9]{8}"))throw new ApiFailure(t("Bitte gültige Adresse und achtstelligen Kopplungscode eingeben.","Enter a valid address and eight-character pairing code."));
            if(lan.startsWith("http:")&&!allowHttp)throw new ApiFailure(t("Bestätige zuerst die unverschlüsselte Verbindung im vertrauenswürdigen Heimnetz.","Confirm the unencrypted connection on your trusted home network first."));
            if(remote!=null&&(!remote.startsWith("https://")||ServerAddress.normalize(remote)==null))throw new ApiFailure(t("Die Fernadresse muss gültiges HTTPS verwenden.","The remote address must use valid HTTPS."));
            JSONObject data=request(lan,"POST","/api/pairing/claim",new JSONObject().put("code",code).put("name",name.trim().isEmpty()?"Android":name.trim()).put("platform","android"),null,10000);
            pairing=new JSONObject().put("lan",lan).put("remote",remote).put("token",data.getString("token")).put("deviceId",data.getString("deviceId"));
            JSONArray persons=new JSONArray();try{persons=request(lan,"GET","/api/app/persons",null,pairing.getString("token"),8000).optJSONArray("persons");}catch(Exception ignored){}
            callback(new JSONObject().put("type","persons").put("persons",persons==null?new JSONArray():persons));
        }catch(Exception e){fail(e);}
    }
    private void handleLink(String value){
        try{Uri u=Uri.parse(value);if(!"hauser".equals(u.getScheme())||!"pair".equals(u.getHost())||!"1".equals(u.getQueryParameter("v")))throw new Exception();
            String lan=ServerAddress.normalize(u.getQueryParameter("lan")),code=u.getQueryParameter("code"),remote=u.getQueryParameter("remote");
            if(lan==null||code==null||!code.matches("[A-HJKMNP-Z2-9]{8}")||(remote!=null&&(!remote.startsWith("https://")||ServerAddress.normalize(remote)==null)))throw new Exception();
            callback(new JSONObject().put("type","link").put("address",lan).put("code",code).put("remote",remote));

        }catch(Exception e){callback(result("error",t("Kein gültiger Hauser-Kopplungscode. Bitte neu aufnehmen oder manuell eingeben.","Not a valid Hauser pairing code. Try another photo or enter it manually.")));}
    }
    private void connect(){
        work.execute(()->{
            try{String token=pairing.getString("token"),lan=pairing.getString("lan"),remote=pairing.optString("remote","");
                String chosen=lan;
                try{request(lan,"GET","/api/build-info",null,token,2500);}catch(Exception e){if(!remote.isEmpty()){request(remote,"GET","/api/build-info",null,token,8000);chosen=remote;}else throw e;}
                // Refuse an old server: a painted room without an authenticated socket is not success.
                try { request(chosen,"POST","/api/pairing/web-session",new JSONObject(),token,8000); } catch (Exception e) { if (e instanceof ApiFailure && (((ApiFailure)e).status==401 || ((ApiFailure)e).status==403)) throw e; if (!(e instanceof ApiFailure && ((ApiFailure)e).status==404 && selectedLan(chosen, lan))) throw new ApiFailure(t("Dieser Hauser-Server unterstützt die Android-Anmeldung noch nicht. Bitte Server aktualisieren oder dessen Zugriff prüfen.","This Hauser server does not yet support Android sign-in. Update the server or check its access rules.")); }
                final String selected=chosen;
                runOnUiThread(()->{
                    CookieManager.getInstance().setCookie(selected,COOKIE+"="+token+"; Path=/; HttpOnly; SameSite=Strict"+(selected.startsWith("https:")?"; Secure":""),ok->{
                        if(Boolean.TRUE.equals(ok)){CookieManager.getInstance().flush();base=selected;showServer(base+"/");}else showError(t("Anmeldung konnte nicht gespeichert werden.","Could not save the sign-in."));
                    });
                });
            }catch(Exception e){runOnUiThread(()->showError(e instanceof ApiFailure?e.getMessage():t("Hauser ist gerade nicht erreichbar. Verbinde dich mit deinem Heimnetz oder prüfe den Fernzugriff.","Hauser is unreachable. Connect to your home network or check remote access.")));}
        });
    }
    private boolean selectedLan(String chosen,String lan){return chosen.equals(lan)&&chosen.startsWith("http://")&&ServerAddress.local(Uri.parse(chosen).getHost());}
    private void showServer(String url){
        onboarding=false;WebView v=newWeb();
        v.setWebViewClient(new WebViewClient(){
            public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest r){
                Uri u=r.getUrl();if(ServerAddress.same(base,u.toString()))return false;
                if(r.isForMainFrame()&&r.hasGesture()&&"https".equals(u.getScheme()))externalUrl(u);return true;
            }
            public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest r){
                // Cleartext is confined to the explicitly selected private origin. HTTPS assets retain normal browser rules.
                if("http".equals(r.getUrl().getScheme())&&!ServerAddress.same(base,r.getUrl().toString()))return blocked();return null;
            }
            public void onReceivedSslError(WebView view,SslErrorHandler handler,SslError e){handler.cancel();showError(t("Das Zertifikat ist ungültig. Korrigiere es am Server oder verwende dessen vertrauenswürdige Adresse.","The certificate is invalid. Correct the server certificate or use its trusted address."));}
            public void onReceivedError(WebView view,WebResourceRequest r,WebResourceError e){if(r.isForMainFrame())showError(t("Hauser ist nicht erreichbar. Bitte Netzwerk und Server prüfen.","Hauser is unreachable. Check the network and server."));}
            public void onReceivedHttpError(WebView view,WebResourceRequest r,WebResourceResponse response){
                int code=response.getStatusCode();if(r.isForMainFrame()||((code==401||code==403)&&ServerAddress.same(base,r.getUrl().toString())))
                    showError(code==401||code==403?t("Anmeldung abgelaufen oder widerrufen. Bitte erneut koppeln; bei Access zuerst anmelden.","Sign-in expired or revoked. Pair again; with Access, sign in first."):t("Der Server antwortet mit Fehler ","Server error ")+code);
            }
            public void onPageFinished(WebView view,String url){
                if(getPreferences(0).getBoolean("handle",false)&&ServerAddress.same(base,url))view.evaluateJavascript("(()=>{let s=document.createElement('style');s.textContent='.app[data-shell=panel]>.status-bar{padding-top:8px!important}.app[data-shell=panel]{--bar-top:56px!important}';document.head.append(s)})()",null);
            }
        });layout(v);web.loadUrl(url);
    }
    private void showError(String message){
        if(destroyed||errorVisible)return;errorVisible=true;
        new AlertDialog.Builder(this).setTitle("Hauser").setMessage(message).setPositiveButton(t("Erneut verbinden","Try again"),(d,w)->{if(pairing!=null)connect();else showOnboarding();})
            .setNeutralButton(t("Verbindung ändern","Change connection"),(d,w)->showOnboarding()).setNegativeButton(t("Schließen","Close"),null).setOnDismissListener(d->errorVisible=false).show();
    }
    private void menu(){new AlertDialog.Builder(this).setTitle("Hauser").setItems(new String[]{t("Neu laden","Reload"),t("Verbindung ändern","Change connection"),t("Vollbild umschalten","Toggle fullscreen"),t("Xiaomi: Platz für Multitasking-Griff umschalten","Xiaomi: toggle multitasking handle spacing"),t("App schließen","Close app")},(d,n)->{
        if(n==0){if(pairing!=null)connect();else web.reload();}
        if(n==1)new AlertDialog.Builder(this).setMessage(t("Neu koppeln? Die bisherige Verbindung wird auf diesem Gerät entfernt. Am Server kannst du sie unter System widerrufen.","Pair again? The current connection will be removed from this device. Revoke it under System on the server."))
            .setPositiveButton(t("Neu koppeln","Pair again"),(x,w)->{pairing=null;getPreferences(0).edit().remove("pairing").apply();CookieManager.getInstance().removeAllCookies(ok->showOnboarding());WebStorage.getInstance().deleteAllData();}).setNegativeButton(t("Zurück","Back"),null).show();
        if(n==2){getPreferences(0).edit().putBoolean("fullscreen",!getPreferences(0).getBoolean("fullscreen",true)).apply();bars();root.requestApplyInsets();}
        if(n==3){getPreferences(0).edit().putBoolean("handle",!getPreferences(0).getBoolean("handle",false)).apply();web.reload();}
        if(n==4)finish();}).show();}
    private void externalUrl(Uri u){try{startActivity(new Intent(Intent.ACTION_VIEW,u));}catch(ActivityNotFoundException ignored){}}
    private void hideCustom(){if(customView!=null){root.removeView(customView);customView=null;customCallback.onCustomViewHidden();customCallback=null;}}
    private void finishPicker(Uri[] uris){if(fileCallback!=null){fileCallback.onReceiveValue(uris);fileCallback=null;}}
    @Override public void onBackPressed(){if(customView!=null){hideCustom();return;}if(onboarding){if(web.canGoBack())web.goBack();else web.evaluateJavascript("window.goBack()",value->{if("false".equals(value))finish();});return;}if(web!=null&&web.canGoBack())web.goBack();else menu();}
    @Override protected void onNewIntent(Intent intent){super.onNewIntent(intent);setIntent(intent);pendingLink=intent.getDataString();showOnboarding();}
    @Override protected void onActivityResult(int req,int result,Intent data){super.onActivityResult(req,result,data);
        if(req==PICK){ArrayList<Uri> selected=new ArrayList<>();
            if(result==RESULT_OK&&data!=null&&pickerOrigin.equals(base)){
                if(data.getData()!=null)selected.add(data.getData());else if(data.getClipData()!=null)for(int i=0;i<data.getClipData().getItemCount();i++)selected.add(data.getClipData().getItemAt(i).getUri());
            }selected.removeIf(u->!"content".equals(u.getScheme()));finishPicker(selected.isEmpty()?null:selected.toArray(new Uri[0]));
        }
        if(req==SCAN&&result==RESULT_OK)work.execute(()->{
            File file=new File(getCacheDir(),"qr.jpg");
            try{BitmapFactory.Options o=new BitmapFactory.Options();o.inJustDecodeBounds=true;BitmapFactory.decodeFile(file.toString(),o);o.inJustDecodeBounds=false;o.inSampleSize=Math.max(1,Math.max(o.outWidth,o.outHeight)/1800);
                Bitmap b=BitmapFactory.decodeFile(file.toString(),o);int w=b.getWidth(),h=b.getHeight();int[] pixels=new int[w*h];b.getPixels(pixels,0,w,0,0,w,h);b.recycle();
                BinaryBitmap binary=new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(w,h,pixels)));
                Map<DecodeHintType,Object> hints=new EnumMap<>(DecodeHintType.class);hints.put(DecodeHintType.POSSIBLE_FORMATS,Collections.singletonList(BarcodeFormat.QR_CODE));hints.put(DecodeHintType.TRY_HARDER,true);
                handleLink(new MultiFormatReader().decode(binary,hints).getText());
            }catch(Exception e){callback(result("error",t("Code nicht erkannt. Bitte den QR-Code vollständig und scharf aufnehmen.","Code not recognized. Photograph the whole QR code in focus.")));}
            finally{file.delete();}
        });
    }
    @Override public void onWindowFocusChanged(boolean focus){super.onWindowFocusChanged(focus);if(focus)bars();}
    @Override public void onPause(){if(web!=null)web.onPause();CookieManager.getInstance().flush();super.onPause();}
    @Override public void onResume(){super.onResume();if(web!=null)web.onResume();}
    @Override public void onDestroy(){destroyed=true;finishPicker(null);work.shutdownNow();if(web!=null){web.removeJavascriptInterface("HauserSetup");web.destroy();}super.onDestroy();}

    private static final class ApiFailure extends IOException{final int status;ApiFailure(String message){this(0,message);}ApiFailure(int status,String message){super(message);this.status=status;}}
    private JSONObject request(String origin,String method,String path,JSONObject body,String token,int timeout)throws Exception{
        HttpURLConnection c=(HttpURLConnection)new URL(origin+path).openConnection();c.setInstanceFollowRedirects(false);c.setConnectTimeout(timeout);c.setReadTimeout(timeout);c.setRequestMethod(method);
        c.setRequestProperty("Accept","application/json");if(token!=null)c.setRequestProperty("Authorization","Bearer "+token);
        try{if(body!=null){c.setDoOutput(true);c.setRequestProperty("Content-Type","application/json");try(OutputStream out=c.getOutputStream()){out.write(body.toString().getBytes(StandardCharsets.UTF_8));}}
            int status=c.getResponseCode();
            if(status<200||status>=300)throw new ApiFailure(status,status==404?t("Code ungültig oder abgelaufen. Erzeuge einen neuen unter System → Telefon koppeln.","Code invalid or expired. Create a new one under System → Pair a phone."):
                status==401||status==403?t("Anmeldung nötig oder widerrufen. Bitte erneut koppeln.","Sign-in required or revoked. Pair again."):
                status>=300&&status<400?t("Die Adresse führt zu einer vorgeschalteten Anmeldung. Nutze im Heimnetz die direkte Hauser-Adresse. Fernzugriff muss Gerätetokens und WebSockets zulassen.","This address redirects to an access login. Use the direct Hauser address at home. Remote access must allow device tokens and WebSockets."):
                t("Hauser antwortet mit Fehler ","Hauser returned error ")+status);
            try(InputStream in=c.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream()){
                byte[] b=new byte[8192];int n;while((n=in.read(b))!=-1){if(out.size()+n>1024*1024)throw new IOException();out.write(b,0,n);}return new JSONObject(out.toString("UTF-8"));}
        }finally{c.disconnect();}
    }
    private javax.crypto.SecretKey key()throws Exception{
        KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);
        if(!store.containsAlias("hauser-pairing")){KeyGenerator g=KeyGenerator.getInstance("AES","AndroidKeyStore");g.init(new KeyGenParameterSpec.Builder("hauser-pairing",KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());g.generateKey();}
        return (javax.crypto.SecretKey)store.getKey("hauser-pairing",null);
    }
    private void savePairing(JSONObject p)throws Exception{
        Cipher c=Cipher.getInstance("AES/GCM/NoPadding");c.init(Cipher.ENCRYPT_MODE,key());
        JSONObject encrypted=new JSONObject().put("iv",Base64.encodeToString(c.getIV(),Base64.NO_WRAP)).put("data",Base64.encodeToString(c.doFinal(p.toString().getBytes(StandardCharsets.UTF_8)),Base64.NO_WRAP));
        getPreferences(0).edit().putString("pairing",encrypted.toString()).commit();
    }
    private JSONObject readPairing()throws Exception{
        String raw=getPreferences(0).getString("pairing",null);if(raw==null)return null;JSONObject e=new JSONObject(raw);
        Cipher c=Cipher.getInstance("AES/GCM/NoPadding");c.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,Base64.decode(e.getString("iv"),Base64.NO_WRAP)));
        return new JSONObject(new String(c.doFinal(Base64.decode(e.getString("data"),Base64.NO_WRAP)),StandardCharsets.UTF_8));
    }
}
