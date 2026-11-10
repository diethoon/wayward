package android.content;

import java.io.File;

public class Context {
    private final File cacheDir;
    public Context(File directory) { cacheDir = directory; }
    public Context getApplicationContext() { return this; }
    public File getCacheDir() { return cacheDir; }
}
