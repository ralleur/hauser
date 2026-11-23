// SPDX-License-Identifier: AGPL-3.0-only
package de.ralleur.hauser;

import android.app.*;
import android.app.admin.DevicePolicyManager;
import android.app.role.RoleManager;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothManager;
import android.content.*;
import android.content.pm.*;
import android.database.ContentObserver;
import android.graphics.*;
import android.graphics.drawable.Drawable;
import android.media.AudioManager;
import android.net.*;
import android.net.wifi.WifiManager;
import android.os.*;
import android.provider.Settings;
import android.util.Base64;
import android.view.*;
import android.webkit.*;
import android.widget.FrameLayout;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.util.*;
import java.util.concurrent.*;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;

/** Tablet home, device controls and curated launcher. Only its offline surface has a native bridge. */
final class TabletShell {
    private final Activity activity;
    private final WebView home, surface;
    private final FrameLayout stage;
    private JSONArray homeNotifications=new JSONArray();
    private String lastFeed="", pendingNotification;
    private boolean readingFeed,importedRead;
    private final android.content.SharedPreferences prefs;
    private final Handler handler=new Handler(Looper.getMainLooper());
    private final ExecutorService images=Executors.newSingleThreadExecutor();
    private JSONArray apps=new JSONArray(),navigation=new JSONArray();
    private long appsVersion,sentAppsVersion=-1;
    private String lastState="",lastStatus="";
    private boolean scanningApps;
    private boolean ready,closed,keyboardVisible;
    private long adminUntil,blockedUntil,openVersion;
    private int attempts,footerHeight;
    private String panel="device";
    private String offlineError;
    private final ContentObserver observer=new ContentObserver(handler){@Override public void onChange(boolean self){refresh();}};
    private final Runnable poll=new Runnable(){public void run(){if(closed)return;refresh();handler.postDelayed(this,2500);}};
    static boolean supported(Activity a){return a.getResources().getConfiguration().smallestScreenWidthDp>=600;}
    TabletShell(Activity activity,WebView home,FrameLayout root){
        this.activity=activity;this.home=home;this.stage=root;prefs=activity.getSharedPreferences("tablet",0);
        surface=LocalSurface.create(activity,"Tablet",new Bridge());
        surface.setVisibility(View.GONE);root.addView(surface,new FrameLayout.LayoutParams(-1,-1));
        surface.loadUrl(LocalSurface.ORIGIN+"/tablet.html");
        activity.getContentResolver().registerContentObserver(Settings.System.CONTENT_URI,true,observer);
        applyDisplay();refreshApps();handler.post(poll);
    }
    private String t(String de,String en){return Locale.getDefault().getLanguage().equals("de")?de:en;}
    void open(String name){
        panel=Arrays.asList("device","apps","store","settings","notifications").contains(name)?name:"device";
        final long version=++openVersion;
        if(offlineError!=null){
            if(!ready)return;
            FrameLayout.LayoutParams layout=(FrameLayout.LayoutParams)surface.getLayoutParams();layout.bottomMargin=0;surface.setLayoutParams(layout);
            surface.evaluateJavascript("window.connectionError("+JSONObject.quote(offlineError)+");window.openPanel("+JSONObject.quote(panel)+",true)",ignored->{
                if(closed||version!=openVersion)return;
                surface.setVisibility(View.VISIBLE);surface.bringToFront();surface.requestFocus();refresh();surface.evaluateJavascript("window.enterTablet()",null);
            });return;
        }
        home.evaluateJavascript("document.documentElement.dataset.tabletPanel='preparing';window.dispatchEvent(new CustomEvent('hauser:tablet-panel',{detail:"+JSONObject.quote(panel)+"}));JSON.stringify({top:document.querySelector('.tab-bar')?.getBoundingClientRect().top??innerHeight,height:innerHeight})",value->{try{
            JSONObject bounds=new JSONObject((String)new JSONTokener(value).nextValue());
            FrameLayout.LayoutParams layout=(FrameLayout.LayoutParams)surface.getLayoutParams();
            footerHeight=Math.max(0,home.getHeight()-(int)Math.round(home.getHeight()*bounds.getDouble("top")/bounds.getDouble("height")));layout.height=FrameLayout.LayoutParams.MATCH_PARENT;layout.bottomMargin=keyboardVisible?0:footerHeight;surface.setLayoutParams(layout);
            home.postOnAnimation(()->{
                if(closed||version!=openVersion)return;
                captureScene(version,()->{
                surface.evaluateJavascript("window.openPanel("+JSONObject.quote(panel)+",true)",ignored->{
                    if(closed||version!=openVersion)return;
                    surface.setVisibility(View.VISIBLE);surface.bringToFront();surface.requestFocus();refresh();
                    surface.evaluateJavascript("window.enterTablet()",entered->{if(!closed&&version==openVersion&&visible())home.evaluateJavascript("document.documentElement.dataset.tabletPanel=\"open\"",null);});
                });
                });
            });
        }catch(Exception ignored){}});
    }
    void keyboard(boolean visible){keyboardVisible=visible;FrameLayout.LayoutParams layout=(FrameLayout.LayoutParams)surface.getLayoutParams();layout.bottomMargin=visible?0:footerHeight;surface.setLayoutParams(layout);if(ready)surface.evaluateJavascript("document.body.classList.toggle('keyboard',"+visible+")",null);}
    boolean back(){if(surface.getVisibility()==View.VISIBLE){surface.evaluateJavascript("window.tabletBack?.()",null);return true;}return false;}
    void hide(){if(offlineError!=null){open("device");return;}++openVersion;surface.evaluateJavascript("window.resetTablet?.()",null);home.evaluateJavascript("delete document.documentElement.dataset.tabletPanel;window.dispatchEvent(new CustomEvent('hauser:tablet-panel',{detail:''}))",null);((android.view.inputmethod.InputMethodManager)activity.getSystemService(Context.INPUT_METHOD_SERVICE)).hideSoftInputFromWindow(surface.getWindowToken(),0);surface.clearFocus();surface.setVisibility(View.GONE);home.requestFocus();}
    void error(String text){boolean first=offlineError==null;offlineError=text;if(first||!visible())open(first?"device":panel);}
    void connected(){if(offlineError==null)return;offlineError=null;surface.evaluateJavascript("window.connectionRestored()",null);hide();}
    boolean visible(){return surface.getVisibility()==View.VISIBLE;}
    void resume(){applyDisplay();refreshApps();refresh();}
    boolean immersive(){return prefs.getBoolean("homeMode",true);}
    void close(){closed=true;handler.removeCallbacksAndMessages(null);images.shutdown();activity.getContentResolver().unregisterContentObserver(observer);surface.removeJavascriptInterface("Tablet");surface.destroy();}
    private boolean automatic(){return Settings.System.canWrite(activity)?systemInt(Settings.System.SCREEN_BRIGHTNESS_MODE,1)==Settings.System.SCREEN_BRIGHTNESS_MODE_AUTOMATIC:prefs.getBoolean("auto",true);}
    private void applyDisplay(){
        stage.setForeground(prefs.getBoolean("nightMode",true)?new android.graphics.drawable.ColorDrawable(BuildConfig.NIGHT_SHADE):null);
        WindowManager.LayoutParams p=activity.getWindow().getAttributes();
        p.screenBrightness=(Settings.System.canWrite(activity)||automatic())?WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE:prefs.getInt("brightness",65)/100f;
        activity.getWindow().setAttributes(p);
        // The wall tablet has exactly two orientations. Locking may keep the
        // current landscape side, but must never preserve a portrait launch.
        boolean landscape=activity.getResources().getConfiguration().orientation==android.content.res.Configuration.ORIENTATION_LANDSCAPE;
        activity.setRequestedOrientation(prefs.getBoolean("rotationLocked",false)&&landscape?ActivityInfo.SCREEN_ORIENTATION_LOCKED:ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
    }
    private int systemInt(String name,int fallback){return Settings.System.getInt(activity.getContentResolver(),name,fallback);}
    private AudioManager audio(){return (AudioManager)activity.getSystemService(Context.AUDIO_SERVICE);}
    private NotificationManager notifications(){return (NotificationManager)activity.getSystemService(Context.NOTIFICATION_SERVICE);}
    private DevicePolicyManager policy(){return (DevicePolicyManager)activity.getSystemService(Context.DEVICE_POLICY_SERVICE);}
    private ComponentName admin(){return new ComponentName(activity,HauserDeviceAdmin.class);}
    private boolean owner(){return policy().isDeviceOwnerApp(activity.getPackageName());}
    private JSONObject snapshot(){
        JSONObject s=new JSONObject();try{
            Intent battery=activity.registerReceiver(null,new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
            int level=battery==null?-1:battery.getIntExtra(BatteryManager.EXTRA_LEVEL,-1),scale=battery==null?100:battery.getIntExtra(BatteryManager.EXTRA_SCALE,100);
            ConnectivityManager cm=(ConnectivityManager)activity.getSystemService(Context.CONNECTIVITY_SERVICE);
            NetworkCapabilities network=cm.getNetworkCapabilities(cm.getActiveNetwork());
            WifiManager wifi=(WifiManager)activity.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            String ssid=wifi.getConnectionInfo().getSSID();if(ssid==null||ssid.equals("<unknown ssid>"))ssid=t("Verbunden","Connected");else ssid=ssid.replace("\"","");
            BluetoothManager bm=(BluetoothManager)activity.getSystemService(Context.BLUETOOTH_SERVICE);BluetoothAdapter bt=bm.getAdapter();
            boolean bluetooth=false;try{bluetooth=bt!=null&&bt.isEnabled();}catch(SecurityException ignored){}
            boolean auto=automatic();
            s.put("deviceModel",Build.MODEL).put("de",Locale.getDefault().getLanguage().equals("de")).put("battery",level<0?-1:Math.round(100f*level/Math.max(1,scale)))
             .put("charging",battery!=null&&battery.getIntExtra(BatteryManager.EXTRA_PLUGGED,0)!=0)
             .put("brightness",(auto||Settings.System.canWrite(activity))?Math.max(3,Math.min(100,Math.round(systemInt(Settings.System.SCREEN_BRIGHTNESS,166)/255f*100))):prefs.getInt("brightness",65)).put("auto",auto)
             .put("volume",Math.round(100f*audio().getStreamVolume(AudioManager.STREAM_MUSIC)/Math.max(1,audio().getStreamMaxVolume(AudioManager.STREAM_MUSIC))))
             .put("wifi",network!=null&&network.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)).put("wifiName",ssid)
             .put("bluetooth",bluetooth).put("bluetoothAccess",activity.checkSelfPermission("android.permission.BLUETOOTH_CONNECT")==PackageManager.PERMISSION_GRANTED)
             .put("quiet",notifications().getCurrentInterruptionFilter()!=NotificationManager.INTERRUPTION_FILTER_ALL)
             .put("quietAccess",notifications().isNotificationPolicyAccessGranted()).put("rotationLocked",prefs.getBoolean("rotationLocked",false))
             .put("timeout",systemInt(Settings.System.SCREEN_OFF_TIMEOUT,120000)).put("canWrite",Settings.System.canWrite(activity))
             .put("home",((RoleManager)activity.getSystemService(Context.ROLE_SERVICE)).isRoleHeld(RoleManager.ROLE_HOME))
             .put("keyboard",new ComponentName(activity,HauserKeyboard.class).flattenToShortString().equals(Settings.Secure.getString(activity.getContentResolver(),Settings.Secure.DEFAULT_INPUT_METHOD)))
             .put("managed",owner()).put("admin",SystemClock.elapsedRealtime()<adminUntil).put("hasPin",prefs.contains("pinHash")).put("pinLength",prefs.getInt("pinLength",6))
             .put("nightMode",prefs.getBoolean("nightMode",true)).put("notificationAccess",notifications().isNotificationListenerAccessGranted(new ComponentName(activity,HauserNotificationListener.class))).put("prototype",BuildConfig.PROTOTYPE).put("navigation",navigation).put("version",activity.getPackageManager().getPackageInfo(activity.getPackageName(),0).versionName).put("appsVersion",appsVersion);
        }catch(Exception ignored){}return s;
    }
    private void refresh(){
        if(closed)return;JSONObject state=snapshot();
        String value=state.toString();
        if(ready&&(visible()||sentAppsVersion!=appsVersion)&&(!value.equals(lastState)||sentAppsVersion!=appsVersion)){
            lastState=value;
            if(sentAppsVersion!=appsVersion)try{state.put("apps",apps);sentAppsVersion=appsVersion;}catch(JSONException ignored){}
            surface.evaluateJavascript("window.render("+state+")",null);
        }
        JSONObject status=new JSONObject();try{status.put("battery",state.optInt("battery",-1)).put("wifi",state.optBoolean("wifi")).put("charging",state.optBoolean("charging"));}catch(Exception ignored){}
        String statusValue=status.toString();
        if(!statusValue.equals(lastStatus)){lastStatus=statusValue;home.evaluateJavascript("window.hauserTabletStatus?.("+status+")",null);}syncNotificationFeed();
    }
    void decorate(){
        readingFeed=false; // A page reload can cancel an outstanding WebView evaluation callback.
        lastStatus="";
        for(String asset:new String[]{"tablet-notifications.css","tablet-host.js","tablet-notifications.js"})try(InputStream in=activity.getAssets().open(asset)){
            ByteArrayOutputStream data=new ByteArrayOutputStream();byte[] b=new byte[4096];int n;while((n=in.read(b))!=-1)data.write(b,0,n);
            String source=data.toString("UTF-8");
            home.evaluateJavascript(asset.endsWith(".css")?"(()=>{if(document.getElementById('hauser-tablet-notification-style'))return;const s=document.createElement('style');s.id='hauser-tablet-notification-style';s.textContent="+JSONObject.quote(source)+";document.head.append(s)})()":source,null);
        }catch(IOException ignored){}refresh();
    }
    private void captureScene(long version,Runnable complete){
        if(visible()||home.getWidth()==0||home.getHeight()==0){complete.run();return;}
        Bitmap scene=Bitmap.createBitmap(Math.max(1,home.getWidth()/2),Math.max(1,home.getHeight()/2),Bitmap.Config.ARGB_8888);
        int[] origin=new int[2];home.getLocationInWindow(origin);
        Rect bounds=new Rect(origin[0],origin[1],origin[0]+home.getWidth(),origin[1]+home.getHeight());
        final int shade=prefs.getBoolean("nightMode",true)?BuildConfig.NIGHT_SHADE:Color.TRANSPARENT;
        // Copy the composed frame asynchronously: WebView.draw() forces a costly software readback.
        PixelCopy.request(activity.getWindow(),bounds,scene,result->{
            if(closed||version!=openVersion){scene.recycle();return;}
            boolean copied=result==PixelCopy.SUCCESS;
            if(!copied){Canvas canvas=new Canvas(scene);canvas.scale(.5f,.5f);home.draw(canvas);}
            images.execute(()->{
                try{
                    // PixelCopy includes the window's night shade. Undo it in the backdrop only;
                    // the shared foreground applies it once again to both scene and controls.
                    float alpha=Color.alpha(shade)/255f;
                    if(copied&&alpha>0&&alpha<1){
                        float gain=1/(1-alpha);
                        ColorMatrix matrix=new ColorMatrix(new float[]{gain,0,0,0,-Color.red(shade)*alpha*gain,0,gain,0,0,-Color.green(shade)*alpha*gain,0,0,gain,0,-Color.blue(shade)*alpha*gain,0,0,0,1,0});
                        Paint paint=new Paint();paint.setColorFilter(new ColorMatrixColorFilter(matrix));
                        new Canvas(scene).drawBitmap(scene,0,0,paint);
                    }
                    ByteArrayOutputStream out=new ByteArrayOutputStream();scene.compress(Bitmap.CompressFormat.JPEG,85,out);
                    String image="data:image/jpeg;base64,"+Base64.encodeToString(out.toByteArray(),Base64.NO_WRAP);
                    handler.post(()->{if(!closed&&version==openVersion)surface.evaluateJavascript("window.setScene?.("+JSONObject.quote(image)+")",ignored->{if(!closed&&version==openVersion)complete.run();});});
                }finally{scene.recycle();}
            });
        },handler);
    }
    void openNotification(String id){pendingNotification=id;open("notifications");}
    private void syncNotificationFeed(){
        if(readingFeed||!ready)return;readingFeed=true;
        home.evaluateJavascript("(()=>{let items=[];const listener=e=>items=e.detail;window.addEventListener('hauser:notification-state',listener,{once:true});window.dispatchEvent(new Event('hauser:notification-request'));window.removeEventListener('hauser:notification-state',listener);return JSON.stringify({items,read:JSON.parse(localStorage.getItem('hauser:tablet-notifications:read:v1')||'{}')})})()",value->{
            readingFeed=false;if(closed)return;
            try{JSONObject data=new JSONObject((String)new JSONTokener(value).nextValue());homeNotifications=data.getJSONArray("items");if(!importedRead){importedRead=true;surface.evaluateJavascript("window.hauserTabletNotifications.importRead("+data.optJSONObject("read")+")",null);}}catch(Exception ignored){}
            JSONArray all=new JSONArray();for(int i=0;i<homeNotifications.length();i++)all.put(homeNotifications.opt(i));
            JSONArray appItems=HauserNotificationListener.snapshot(activity);for(int i=0;i<appItems.length();i++)all.put(appItems.opt(i));
            String feed=all.toString();if(!feed.equals(lastFeed)){lastFeed=feed;surface.evaluateJavascript("window.dispatchEvent(new CustomEvent('hauser:notification-state',{detail:"+feed+"}))",null);}
            if(visible()&&panel.equals("notifications")){String id=pendingNotification;pendingNotification=null;surface.evaluateJavascript("if(!document.querySelector('.htn-center').open)window.hauserTabletNotifications.open("+(id==null?"undefined":JSONObject.quote(id))+")",null);}
        });
    }
    private void refreshApps(){
        if(scanningApps||closed)return;scanningApps=true;
        images.execute(()->{
        JSONArray list=new JSONArray();PackageManager pm=activity.getPackageManager();
        List<ResolveInfo> activities=pm.queryIntentActivities(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER),0);
        activities.sort((a,b)->a.loadLabel(pm).toString().compareToIgnoreCase(b.loadLabel(pm).toString()));
        Set<String> seen=new HashSet<>();
        for(ResolveInfo info:activities){String p=info.activityInfo.packageName;
            if(!seen.add(p)||p.equals(activity.getPackageName())||p.equals("com.android.settings")||p.equals("com.android.vending")||p.contains("permissioncontroller")||p.equals("com.miui.home")||p.equals("com.mi.android.globallauncher")||Arrays.asList("com.miui.securitycenter","com.android.thememanager","com.miui.huanji","com.google.android.apps.safetyhub").contains(p))continue;
            try{
                Drawable drawable=info.loadIcon(pm);Bitmap bitmap=Bitmap.createBitmap(72,72,Bitmap.Config.ARGB_8888);drawable.setBounds(0,0,72,72);drawable.draw(new Canvas(bitmap));
                ByteArrayOutputStream png=new ByteArrayOutputStream();bitmap.compress(Bitmap.CompressFormat.PNG,100,png);bitmap.recycle();
                list.put(new JSONObject().put("package",p).put("name",info.loadLabel(pm)).put("icon","data:image/png;base64,"+Base64.encodeToString(png.toByteArray(),Base64.NO_WRAP)));
            }catch(Exception ignored){}
        }
        handler.post(()->{scanningApps=false;if(closed)return;apps=list;appsVersion++;refresh();});
        });
    }
    private void message(String text){if(ready)surface.evaluateJavascript("window.notice("+JSONObject.quote(text)+")",null);}
    private boolean requireAdmin(){if(SystemClock.elapsedRealtime()<adminUntil)return true;surface.evaluateJavascript("window.askAdmin()",null);return false;}
    private void launch(Intent intent){try{activity.startActivity(intent);}catch(Exception e){message(t("Diese Funktion ist auf dem Tablet nicht verfügbar.","This feature is not available on this tablet."));}}
    private void pin(String raw,boolean create){
        if(SystemClock.elapsedRealtime()<blockedUntil){message(t("Bitte warte kurz vor dem nächsten Versuch.","Please wait before trying again."));return;}
        if(!raw.matches("[0-9]{6,12}")){message(t("Die Admin-PIN braucht 6 bis 12 Ziffern.","Use 6 to 12 digits for the admin PIN."));return;}
        if(create&&prefs.contains("pinHash"))return;
        new Thread(()->{try{
            byte[] salt;if(create){salt=new byte[24];new SecureRandom().nextBytes(salt);}else salt=Base64.decode(prefs.getString("pinSalt",""),Base64.NO_WRAP);
            PBEKeySpec spec=new PBEKeySpec(raw.toCharArray(),salt,120000,256);byte[] hash=SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded();spec.clearPassword();
            boolean ok=create||MessageDigest.isEqual(hash,Base64.decode(prefs.getString("pinHash",""),Base64.NO_WRAP));
            activity.runOnUiThread(()->{
                if(closed)return;
                if(ok){if(create)prefs.edit().putString("pinHash",Base64.encodeToString(hash,Base64.NO_WRAP)).putString("pinSalt",Base64.encodeToString(salt,Base64.NO_WRAP)).apply();prefs.edit().putInt("pinLength",raw.length()).apply();adminUntil=SystemClock.elapsedRealtime()+120000;attempts=0;surface.evaluateJavascript("window.adminAccepted()",null);refresh();}
                else{attempts++;if(attempts>=5){blockedUntil=SystemClock.elapsedRealtime()+30000;attempts=0;}message(t("PIN stimmt nicht.","Incorrect PIN."));surface.evaluateJavascript("window.pinRejected()",null);}
            });
        }catch(Exception e){activity.runOnUiThread(()->message(t("Adminzugang konnte nicht geöffnet werden.","Could not open admin access.")));}},"hauser-admin").start();
    }
    public final class Bridge {
        @JavascriptInterface public void ready(){activity.runOnUiThread(()->{if(closed)return;ready=true;lastState="";sentAppsVersion=-1;keyboard(keyboardVisible);if(offlineError!=null)open(panel);else surface.evaluateJavascript("window.openPanel("+JSONObject.quote(panel)+",true)",null);refresh();});}
        @JavascriptInterface public void command(String action,String json){
            if(action==null||json==null||json.length()>4096)return;
            activity.runOnUiThread(()->{if(closed)return;try{act(action,new JSONObject(json));}catch(Exception e){message(t("Änderung nicht möglich. Prüfe die Freigabe im Adminbereich.","Could not change this setting. Check its permission in admin settings."));}refresh();});
        }
    }
    private void act(String action,JSONObject data)throws Exception{
        int value=Math.max(0,Math.min(100,data.optInt("value")));
        switch(action){
            case "close":hide();break;
            case "panel":String name=data.optString("name");if(Arrays.asList("device","apps","store","settings","notifications").contains(name)){panel=name;home.evaluateJavascript("window.dispatchEvent(new CustomEvent('hauser:tablet-panel',{detail:"+JSONObject.quote(panel)+"}))",null);}break;
            case "notifications":open("notifications");break;
            case "storeSearch":String query=data.optString("query").trim();if(!query.isEmpty()&&query.length()<=200)launch(new Intent(Intent.ACTION_VIEW,Uri.parse("https://play.google.com/store/search").buildUpon().appendQueryParameter("q",query).appendQueryParameter("c","apps").build()).setPackage("com.android.vending"));break;
            case "nightMode":prefs.edit().putBoolean("nightMode",!prefs.getBoolean("nightMode",true)).apply();applyDisplay();break;
            case "notificationBadge":home.evaluateJavascript("window.hauserTabletBadge?.("+Math.max(0,data.optInt("count"))+")",null);break;
            case "notificationRead":home.evaluateJavascript("window.hauserTabletNotifications?.setRead("+JSONObject.quote(data.optString("id"))+","+data.optBoolean("read")+")",null);break;
            case "notificationAction":String id=data.optString("id"),operation=data.optString("action");if(!Arrays.asList("activate","dismiss").contains(operation))break;if(id.startsWith("android:")){if(HauserNotificationListener.action(id,operation)&&operation.equals("activate"))hide();}else home.evaluateJavascript("window.dispatchEvent(new CustomEvent(\"hauser:notification-command\",{detail:{action:"+JSONObject.quote(operation)+",id:"+JSONObject.quote(id)+"}}))",null);break;
            case "reload":hide();((MainActivity)activity).reconnectTablet();break;
            case "brightness":prefs.edit().putBoolean("auto",false).putInt("brightness",Math.max(3,value)).apply();if(Settings.System.canWrite(activity)){Settings.System.putInt(activity.getContentResolver(),Settings.System.SCREEN_BRIGHTNESS_MODE,Settings.System.SCREEN_BRIGHTNESS_MODE_MANUAL);Settings.System.putInt(activity.getContentResolver(),Settings.System.SCREEN_BRIGHTNESS,Math.round(Math.max(3,value)*255f/100));}applyDisplay();break;
            case "auto":boolean automatic=!automatic();prefs.edit().putBoolean("auto",automatic).apply();if(Settings.System.canWrite(activity))Settings.System.putInt(activity.getContentResolver(),Settings.System.SCREEN_BRIGHTNESS_MODE,automatic?Settings.System.SCREEN_BRIGHTNESS_MODE_AUTOMATIC:Settings.System.SCREEN_BRIGHTNESS_MODE_MANUAL);applyDisplay();break;
            case "volume":audio().setStreamVolume(AudioManager.STREAM_MUSIC,Math.round(value/100f*audio().getStreamMaxVolume(AudioManager.STREAM_MUSIC)),0);break;
            case "rotation":prefs.edit().putBoolean("rotationLocked",!prefs.getBoolean("rotationLocked",false)).apply();applyDisplay();break;
            case "quiet":if(notifications().isNotificationPolicyAccessGranted())notifications().setInterruptionFilter(notifications().getCurrentInterruptionFilter()==NotificationManager.INTERRUPTION_FILTER_ALL?NotificationManager.INTERRUPTION_FILTER_PRIORITY:NotificationManager.INTERRUPTION_FILTER_ALL);else message(t("Ruhemodus benötigt einmalig die Freigabe unter Geräteeinstellungen → Admin.","Allow quiet mode once in Device settings → Admin."));break;
            case "bluetooth":if(owner()){
                BluetoothAdapter bt=((BluetoothManager)activity.getSystemService(Context.BLUETOOTH_SERVICE)).getAdapter();if(bt.isEnabled())bt.disable();else bt.enable();
            }else surface.evaluateJavascript("window.openConnection('bluetooth')",null);break;
            case "wifi":surface.evaluateJavascript("window.openConnection('wifi')",null);break;
            case "navigate":String target=data.optString("screen");if(Arrays.asList("home","energy","calendar","notes","media","library","ablage","system").contains(target)){hide();home.evaluateJavascript("document.querySelector('[data-nav="+target+"]')?.click()",null);}break;
            case "app":String p=data.optString("package");boolean known=false;for(int i=0;i<apps.length();i++)if(p.equals(apps.getJSONObject(i).getString("package")))known=true;
                if(known){Intent app=activity.getPackageManager().getLaunchIntentForPackage(p);if(app!=null){hide();launch(app);}}break;
            case "pin":pin(data.optString("pin"),data.optBoolean("create"));break;
            case "lockAdmin":adminUntil=0;break;
            case "timeout":int timeout=data.optInt("milliseconds");if(Arrays.asList(30000,60000,120000,300000,600000,2147483647).contains(timeout)&&Settings.System.canWrite(activity))Settings.System.putInt(activity.getContentResolver(),Settings.System.SCREEN_OFF_TIMEOUT,timeout);else message(t("Bildschirmruhe benötigt die Gerätefreigabe im Adminbereich.","Screen timeout needs permission in admin settings."));break;
            case "adminAction":if(!requireAdmin())return;adminAction(data.optString("name"),data.optString("package"));break;
        }
    }
    private void adminAction(String name,String pkg)throws Exception{
        switch(name){
            case "home":RoleManager roles=(RoleManager)activity.getSystemService(Context.ROLE_SERVICE);if(!roles.isRoleHeld(RoleManager.ROLE_HOME))activity.startActivityForResult(roles.createRequestRoleIntent(RoleManager.ROLE_HOME),91);break;
            case "keyboard":launch(new Intent(Settings.ACTION_INPUT_METHOD_SETTINGS));break;
            case "chooseKeyboard":((android.view.inputmethod.InputMethodManager)activity.getSystemService(Context.INPUT_METHOD_SERVICE)).showInputMethodPicker();break;
            case "displayPermission":launch(new Intent(Settings.ACTION_MANAGE_WRITE_SETTINGS,Uri.parse("package:"+activity.getPackageName())));break;
            case "notificationPermission":launch(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS).putExtra(Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME,new ComponentName(activity,HauserNotificationListener.class).flattenToString()));break;
            case "quietPermission":launch(new Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS));break;
            case "bluetoothPermission":if(Build.VERSION.SDK_INT>=31)activity.requestPermissions(new String[]{"android.permission.BLUETOOTH_CONNECT"},92);break;
            case "wifi":launch(new Intent(Settings.ACTION_WIFI_SETTINGS));break;
            case "bluetooth":launch(new Intent(Settings.ACTION_BLUETOOTH_SETTINGS));break;
            case "android":launch(new Intent(Settings.ACTION_SETTINGS));break;
            case "store":if(!Arrays.asList("de.WDR.DerElefant","com.openai.chatgpt","com.google.android.youtube","com.spotify.music","org.jellyfin.mobile","com.google.android.apps.photos","com.google.android.calendar").contains(pkg))return;
                launch(new Intent(Intent.ACTION_VIEW,Uri.parse("https://play.google.com/store/apps/details?id="+pkg)).setPackage("com.android.vending"));break;
            case "update":if(BuildConfig.PROTOTYPE)message(t("Dieser Tablet-Prototyp wird lokal aktualisiert.","This tablet prototype is updated locally."));else launch(new Intent(Intent.ACTION_VIEW,Uri.parse("https://hauserhome.app/de/android/")));break;
            case "kiosk":if(!owner()){message(t("Vollständige Systemsperre benötigt ein separat als Hausgerät eingerichtetes Tablet. Dieses persönliche Gerät wird nicht zurückgesetzt.","Full system lockdown requires a separately provisioned dedicated tablet. This personal device will not be reset."));break;}
                ArrayList<String> allowed=new ArrayList<>();allowed.add(activity.getPackageName());for(int i=0;i<apps.length();i++)allowed.add(apps.getJSONObject(i).getString("package"));policy().setLockTaskPackages(admin(),allowed.toArray(new String[0]));
                policy().setLockTaskFeatures(admin(),DevicePolicyManager.LOCK_TASK_FEATURE_HOME);
                IntentFilter filter=new IntentFilter(Intent.ACTION_MAIN);filter.addCategory(Intent.CATEGORY_HOME);filter.addCategory(Intent.CATEGORY_DEFAULT);
                policy().addPersistentPreferredActivity(admin(),filter,new ComponentName(activity,MainActivity.class));activity.startLockTask();break;
            case "leaveKiosk":activity.stopLockTask();break;
        }
    }
}
