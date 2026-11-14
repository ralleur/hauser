// SPDX-License-Identifier: AGPL-3.0-only
import de.ralleur.hauser.ServerAddress;
public class ServerAddressTest {
  public static void main(String[] a){
    check("http://homeassistant.local:4173",ServerAddress.normalize("homeassistant.local:4173/"));
    check("https://home.example",ServerAddress.normalize("https://HOME.example:443/"));
    check("http://10.0.2.2:4173",ServerAddress.normalize("http://10.0.2.2:4173"));
    for(String s:new String[]{"http://example.com","https://a:b@home.example","file:///etc/passwd","javascript:alert(1)","https://home.example/path","https://home.example?token=abc","http://172.16.999.1","https://home.example:65536","https://home.example#x"})check(null,ServerAddress.normalize(s));
    if(!ServerAddress.same("https://home.example","https://home.example/api/config")||ServerAddress.same("https://home.example","https://home.example.evil/"))throw new AssertionError();
    System.out.println("server_address_policy=PASS");
  }
  static void check(String expected,String actual){if(!java.util.Objects.equals(expected,actual))throw new AssertionError(expected+" != "+actual);}
}
