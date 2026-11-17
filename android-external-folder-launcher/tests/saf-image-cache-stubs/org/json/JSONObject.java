package org.json;

import java.util.LinkedHashMap;
import java.util.Map;

public final class JSONObject {
    private final Map<String, Object> values = new LinkedHashMap<>();
    public JSONObject put(String key, Object value) {
        values.put(key, value);
        return this;
    }
    public Object opt(String key) { return values.get(key); }
    public boolean has(String key) { return values.containsKey(key); }
}
