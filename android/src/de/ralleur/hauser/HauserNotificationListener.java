// SPDX-License-Identifier: AGPL-3.0-only
package de.ralleur.hauser;

import android.app.*;
import android.content.*;
import android.graphics.*;
import android.graphics.drawable.Drawable;
import android.service.notification.*;
import android.util.Base64;
import org.json.*;
import java.io.ByteArrayOutputStream;
import java.util.*;

/** Active Android app notifications stay in process memory and the offline UI.
 * Nothing is written to disk or sent to the paired Hauser page/server. */
public final class HauserNotificationListener extends NotificationListenerService {
    private static HauserNotificationListener connected;
    private final Map<String,StatusBarNotification> active=new LinkedHashMap<>();
    @Override public void onListenerConnected(){synchronized(HauserNotificationListener.class){connected=this;active.clear();for(StatusBarNotification n:getActiveNotifications())active.put(n.getKey(),n);}}
    @Override public void onListenerDisconnected(){synchronized(HauserNotificationListener.class){connected=null;active.clear();}requestRebind(new ComponentName(this,HauserNotificationListener.class));}
    @Override public void onNotificationPosted(StatusBarNotification n){synchronized(HauserNotificationListener.class){active.put(n.getKey(),n);}}
    @Override public void onNotificationRemoved(StatusBarNotification n){synchronized(HauserNotificationListener.class){active.remove(n.getKey());}}
    static synchronized JSONArray snapshot(Context context){
        JSONArray result=new JSONArray();
        if(connected==null||((KeyguardManager)context.getSystemService(Context.KEYGUARD_SERVICE)).isDeviceLocked())return result;
        for(StatusBarNotification sbn:connected.active.values())try{
            Notification n=sbn.getNotification();
            if(sbn.getPackageName().equals(context.getPackageName())||sbn.isOngoing()||(n.flags&Notification.FLAG_GROUP_SUMMARY)!=0||n.visibility==Notification.VISIBILITY_SECRET)continue;
            CharSequence title=n.extras.getCharSequence(Notification.EXTRA_TITLE),text=n.extras.getCharSequence(Notification.EXTRA_BIG_TEXT);
            if(text==null)text=n.extras.getCharSequence(Notification.EXTRA_TEXT);
            String label=context.getPackageManager().getApplicationLabel(context.getPackageManager().getApplicationInfo(sbn.getPackageName(),0)).toString();
            if(title==null&&text==null)continue;
            Drawable drawable=context.getPackageManager().getApplicationIcon(sbn.getPackageName());Bitmap bitmap=Bitmap.createBitmap(64,64,Bitmap.Config.ARGB_8888);drawable.setBounds(0,0,64,64);drawable.draw(new Canvas(bitmap));ByteArrayOutputStream png=new ByteArrayOutputStream();bitmap.compress(Bitmap.CompressFormat.PNG,100,png);bitmap.recycle();
            JSONObject item=new JSONObject().put("id","android:"+sbn.getKey()).put("dedupeKey","android:"+sbn.getKey()).put("source","android-app").put("sourceLabel",label).put("group","apps")
                .put("title",title==null?label:title.toString()).put("message",text==null?"":text.toString()).put("createdAt",sbn.getPostTime()).put("priority",n.category!=null&&n.category.equals(Notification.CATEGORY_ALARM)?90:50)
                .put("type",Notification.CATEGORY_ALARM.equals(n.category)?"critical":"info").put("dismissible",sbn.isClearable()).put("iconData","data:image/png;base64,"+Base64.encodeToString(png.toByteArray(),Base64.NO_WRAP));
            if(n.contentIntent!=null)item.put("action","android-open");result.put(item);
        }catch(Exception ignored){}
        return result;
    }
    static synchronized boolean action(String id,String action){
        if(connected==null||!id.startsWith("android:"))return false;
        StatusBarNotification sbn=connected.active.get(id.substring(8));if(sbn==null)return false;
        try{if(action.equals("dismiss")&&sbn.isClearable()){connected.cancelNotification(sbn.getKey());return true;}if(action.equals("activate")&&sbn.getNotification().contentIntent!=null){sbn.getNotification().contentIntent.send();return true;}}catch(PendingIntent.CanceledException ignored){}return false;
    }
}
