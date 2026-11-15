// SPDX-License-Identifier: AGPL-3.0-only
package de.ralleur.hauser;

import android.content.Context;
import android.graphics.Color;
import android.webkit.*;
import java.io.ByteArrayInputStream;
import java.util.Collections;

/** Privileged UI lives in an offline WebView, never in the paired server or an app's page. */
final class LocalSurface {
    static final String ORIGIN="https://hauser-tablet.invalid";
    static WebView create(Context context, String bridgeName, Object bridge) {
        WebView view=new WebView(context);
        view.setBackgroundColor(Color.TRANSPARENT);
        WebSettings s=view.getSettings();s.setJavaScriptEnabled(true);s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setDomStorageEnabled(true);s.setSupportMultipleWindows(false);s.setSaveFormData(false);
        view.addJavascriptInterface(bridge,bridgeName);
        view.setWebViewClient(new WebViewClient(){
            @Override public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest r){return true;}
            @Override public WebResourceResponse shouldInterceptRequest(WebView v,WebResourceRequest r){
                String path=r.getUrl().getPath();
                if(!ORIGIN.equals(r.getUrl().getScheme()+"://"+r.getUrl().getAuthority())||!"GET".equals(r.getMethod())||path==null||!path.matches("/[a-zA-Z0-9._-]+"))return denied();
                try {
                    String mime=path.endsWith(".html")?"text/html":path.endsWith(".js")?"text/javascript":path.endsWith(".css")?"text/css":path.endsWith(".woff2")?"font/woff2":path.endsWith(".avif")?"image/avif":path.endsWith(".svg")?"image/svg+xml":"text/plain";
                    return new WebResourceResponse(mime,"utf-8",context.getAssets().open(path.substring(1)));
                }catch(Exception e){return denied();}
            }
        });
        view.setWebChromeClient(new WebChromeClient(){@Override public void onPermissionRequest(PermissionRequest request){request.deny();}});
        return view;
    }
    static WebResourceResponse denied(){return new WebResourceResponse("text/plain","utf-8",403,"Blocked",Collections.emptyMap(),new ByteArrayInputStream(new byte[0]));}
}
