// SPDX-License-Identifier: AGPL-3.0-only
package de.ralleur.hauser;
import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import java.io.File;
import java.io.FileNotFoundException;
/** One private, temporary QR photo; never exposes arbitrary paths. */
public final class CaptureProvider extends ContentProvider {
    public boolean onCreate(){return true;}
    public String getType(Uri u){return "image/jpeg";}
    public ParcelFileDescriptor openFile(Uri u,String mode)throws FileNotFoundException {
        if(!"/qr.jpg".equals(u.getPath()))throw new FileNotFoundException();
        return ParcelFileDescriptor.open(new File(getContext().getCacheDir(),"qr.jpg"),ParcelFileDescriptor.parseMode(mode));
    }
    public Cursor query(Uri u,String[] p,String s,String[] a,String o){return null;}
    public Uri insert(Uri u,ContentValues v){throw new UnsupportedOperationException();}
    public int update(Uri u,ContentValues v,String s,String[] a){throw new UnsupportedOperationException();}
    public int delete(Uri u,String s,String[] a){return 0;}
}
