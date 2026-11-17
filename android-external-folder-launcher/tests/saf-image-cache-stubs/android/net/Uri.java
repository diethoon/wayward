package android.net;

public final class Uri {
    private final String value;
    private Uri(String source) { value = source; }
    public static Uri parse(String source) { return new Uri(source); }
    @Override public String toString() { return value; }
}
