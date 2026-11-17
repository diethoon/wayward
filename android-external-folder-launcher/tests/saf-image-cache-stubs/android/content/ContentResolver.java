package android.content;

import android.net.Uri;
import java.io.IOException;
import java.io.InputStream;

public abstract class ContentResolver {
    public abstract InputStream openInputStream(Uri uri) throws IOException;
}
