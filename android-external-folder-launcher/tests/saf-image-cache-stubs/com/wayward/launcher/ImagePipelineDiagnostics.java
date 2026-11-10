package com.wayward.launcher;

import android.content.Context;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

final class ImagePipelineDiagnostics {
    static final List<RecordedEvent> EVENTS = Collections.synchronizedList(new ArrayList<>());
    static void record(Context context, String event, JSONObject details) {
        EVENTS.add(new RecordedEvent(event, details));
    }
    static final class RecordedEvent {
        final String event;
        final JSONObject details;
        RecordedEvent(String name, JSONObject data) { event = name; details = data; }
    }
}
