// SPDX-License-Identifier: AGPL-3.0-only
package de.ralleur.hauser;
import java.net.URI;
import java.util.Locale;

/** Same origin everywhere. HTTP only for literal private addresses and local names, never public HTTP. */
public final class ServerAddress {
    public static String normalize(String raw) {
        String value = raw.trim();
        if (!value.contains("://")) value = "http://" + value;
        try {
            URI u = new URI(value);
            String scheme = u.getScheme().toLowerCase(Locale.ROOT), host = u.getHost();
            if (host == null || u.getUserInfo() != null || u.getRawQuery() != null || u.getRawFragment() != null
                || !(u.getPath().isEmpty() || u.getPath().equals("/")) || u.getPort() == 0 || u.getPort() > 65535) return null;
            host = host.toLowerCase(Locale.ROOT);
            if (!scheme.equals("https") && !(scheme.equals("http") && local(host))) return null;
            int port = u.getPort();
            if (port == (scheme.equals("https") ? 443 : 80)) port = -1;
            return scheme + "://" + host + (port == -1 ? "" : ":" + port);
        } catch (Exception e) { return null; }
    }
    public static boolean local(String host) {
        if (host.equals("localhost") || host.endsWith(".local") || (!host.contains(".") && !host.contains(":"))) return true;
        if (host.startsWith("[")) return host.startsWith("[fd") || host.startsWith("[fc") || host.startsWith("[fe80:") || host.equals("[::1]");
        String[] p = host.split("\\.");
        if (p.length != 4) return false;
        int[] a = new int[4];
        try { for (int i=0;i<4;i++) { if (!p[i].matches("[0-9]{1,3}")) return false; a[i]=Integer.parseInt(p[i]); if(a[i]>255)return false; } }
        catch(Exception e){return false;}
        return a[0]==10 || a[0]==127 || (a[0]==192 && a[1]==168) || (a[0]==172 && a[1]>=16 && a[1]<=31)
            || (a[0]==169 && a[1]==254) || (a[0]==100 && a[1]>=64 && a[1]<=127);
    }
    public static boolean same(String base, String target) {
        try { URI u=new URI(target); return base.equals(normalize(u.getScheme()+"://"+u.getRawAuthority())); }
        catch(Exception e){return false;}
    }
}
