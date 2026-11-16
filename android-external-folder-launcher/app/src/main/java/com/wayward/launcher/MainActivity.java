package com.wayward.launcher;

import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.DocumentsContract;
import android.provider.MediaStore;
import android.text.InputType;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.SequenceInputStream;
import java.io.OutputStream;
import java.lang.ref.WeakReference;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class MainActivity extends Activity {
    private static final int PICK_TREE=4101;
    private static final String PREFS="wayward_launcher";
    private static final String KEY_TREE="game_tree_uri", KEY_PROFILES="game_profiles", KEY_ZIP_REV="zip_mod_revision", KEY_COMFY_URL="comfy_server_url";
    private static final String KO="Wayward_WML_ko.html", EN="Wayward_WML.html";
    private static final Pattern ID=Pattern.compile("^[a-z0-9][a-z0-9._-]*$");
    private static final Set<String> RUNNING_SESSIONS=Collections.synchronizedSet(new HashSet<>());
    // The home launcher and game sessions are separate Android document tasks.
    // Keep weak references so settings actions can return to the Activity that
    // actually owns the active game's WebView and SAF tree.
    private static final Map<String, WeakReference<MainActivity>> SESSION_ACTIVITIES =
            new ConcurrentHashMap<>();
    private static volatile String LAST_ACTIVE_SESSION_ID = "";
    private static final String EXTRA_OPEN_IMAGE_STUDIO_SETTINGS =
            "com.wayward.launcher.OPEN_IMAGE_STUDIO_SETTINGS";
    private static final Pattern MOD_ID=Pattern.compile("(?:\\bid\\s*:\\s*|[\\\"']id[\\\"']\\s*:\\s*)[\\\"']([a-z0-9][a-z0-9._-]*)[\\\"']");
    private Uri treeUri;
    private SafTree tree;
    private ZipModStore zipMods;
    private final List<GameProfile> profiles=new ArrayList<>();
    private String activeProfileId="";
    private long loadedZipRevision=-1;
    private FrameLayout root;
    private LinearLayout home, profileList;
    private TextView status, folderText, profileSummary, imageGenStatus;
    private EditText comfyUrlInput;
    private String imageGenSessionMessage = "";
    private boolean imageStudioSessionDetected = false;
    private boolean pendingOpenImageStudioSettings = false;
    private static volatile boolean imageGenCopying = false;
    private static volatile boolean manualImageGenPreparing = false;
    private final Handler imageGenHandler = new Handler(Looper.getMainLooper());
    private final List<Runnable> imageGenReadyCallbacks = new ArrayList<>();
    private Runnable imageGenPollRunnable;
    private WebView web;
    private WebFileChooser webFileChooser;

    @Override public void onCreate(Bundle b){
        super.onCreate(b);
        DiagnosticsLogger.event(this,"INFO","launcher","activity_create",null);
        DiagnosticsUploader.uploadPending(this);
        zipMods=new ZipModStore(getFilesDir());
        loadProfiles();
        showHome();
        String sessionId=sessionProfileId(getIntent());
        if(sessionId!=null)openProfileSession(sessionId);
        else refreshStatus();
    }
    @Override protected void onResume(){
        super.onResume();
        DiagnosticsLogger.event(this,"INFO","launcher","activity_resume",null);
        DiagnosticsUploader.uploadPending(this);
        loadProfiles();
        long revision=getSharedPreferences(PREFS,MODE_PRIVATE).getLong(KEY_ZIP_REV,0);
        if(web!=null&&revision!=loadedZipRevision){loadedZipRevision=revision;web.reload();}
        if(web!=null&&tree!=null)registerSessionActivity();
        if(home!=null&&home.getVisibility()==View.VISIBLE){renderProfiles();refreshStatus();refreshImageGenStatus();}
    }
    @Override protected void onNewIntent(Intent intent){
        super.onNewIntent(intent);setIntent(intent);
        String sessionId=sessionProfileId(intent);
        if(sessionId==null)return;
        boolean openSettings=intent.getBooleanExtra(EXTRA_OPEN_IMAGE_STUDIO_SETTINGS,false);
        if(openSettings)pendingOpenImageStudioSettings=true;
        if(sessionId.equals(activeProfileId)&&web!=null){
            if(home!=null)home.setVisibility(View.GONE);
            web.setVisibility(View.VISIBLE);
            registerSessionActivity();
            if(openSettings){
                pendingOpenImageStudioSettings=false;
                openImageGenPanel();
            }
        }else openProfileSession(sessionId);
    }
    private static final class GameProfile{
        final String id,uri,label;
        GameProfile(String i,String u,String n){id=i;uri=u;label=n;}
    }
    private int dp(float n){return Math.round(n*getResources().getDisplayMetrics().density);}
    private void status(String s){if(status!=null)status.setText(s);}
    private LinearLayout.LayoutParams buttonParams(){return new LinearLayout.LayoutParams(-1,dp(46));}
    private android.graphics.drawable.GradientDrawable uiShape(int fill,int stroke,float radius){
        android.graphics.drawable.GradientDrawable shape=new android.graphics.drawable.GradientDrawable();
        shape.setColor(fill);shape.setCornerRadius(dp(radius));
        if(stroke!=0)shape.setStroke(dp(1),stroke);
        return shape;
    }
    private LinearLayout uiCard(){
        LinearLayout card=new LinearLayout(this);card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(13),dp(12),dp(13),dp(12));
        card.setBackground(uiShape(Color.WHITE,Color.rgb(229,232,235),16));
        return card;
    }
    private TextView uiText(String value,float size,int color,boolean bold){
        TextView text=new TextView(this);text.setText(value);text.setTextSize(size);text.setTextColor(color);
        text.setIncludeFontPadding(false);
        if(bold)text.setTypeface(null,android.graphics.Typeface.BOLD);
        return text;
    }
    private void gap(LinearLayout parent,int height){
        View spacer=new View(this);parent.addView(spacer,new LinearLayout.LayoutParams(1,dp(height)));
    }
    private Button button(String label,boolean primary,Runnable run){
        Button b=new Button(this);b.setText(label);b.setAllCaps(false);b.setTextSize(13);
        b.setTextColor(primary?Color.WHITE:Color.rgb(35,39,43));
        b.setPadding(dp(12),dp(5),dp(12),dp(5));b.setMinHeight(dp(42));
        b.setBackground(uiShape(primary?Color.rgb(35,39,43):Color.WHITE,primary?0:Color.rgb(218,222,226),12));
        b.setOnClickListener(v->run.run());return b;
    }
    private Button compactButton(String label,boolean primary,Runnable action){
        Button b=new Button(this);b.setText(label);b.setAllCaps(false);b.setTextSize(12);
        b.setTextColor(primary?Color.WHITE:Color.rgb(43,47,52));b.setPadding(dp(9),dp(3),dp(9),dp(3));
        b.setMinHeight(dp(36));b.setBackground(uiShape(primary?Color.rgb(43,47,52):Color.rgb(246,247,248),
                primary?0:Color.rgb(224,227,230),10));
        b.setOnClickListener(v->action.run());return b;
    }
    private void showHome(){
        root=new FrameLayout(this);root.setBackgroundColor(Color.rgb(246,247,248));
        ScrollView scroll=new ScrollView(this);scroll.setFillViewport(true);scroll.setVerticalScrollBarEnabled(false);
        LinearLayout page=new LinearLayout(this);page.setOrientation(LinearLayout.VERTICAL);
        page.setPadding(dp(16),dp(13),dp(16),dp(24));scroll.addView(page);

        LinearLayout top=new LinearLayout(this);top.setGravity(android.view.Gravity.CENTER_VERTICAL);
        TextView title=uiText("WAYWARD",24,Color.rgb(24,27,31),true);title.setLetterSpacing(0.035f);
        top.addView(title,new LinearLayout.LayoutParams(0,-2,1f));
        Button addFolder=compactButton("＋ 폴더",true,this::chooseFolder);
        LinearLayout.LayoutParams addFolderParams=new LinearLayout.LayoutParams(dp(82),dp(38));
        addFolderParams.leftMargin=dp(6);top.addView(addFolder,addFolderParams);
        Button info=compactButton("안내",false,this::showLauncherInfoDialog);
        LinearLayout.LayoutParams infoParams=new LinearLayout.LayoutParams(dp(56),dp(38));
        infoParams.leftMargin=dp(5);top.addView(info,infoParams);
        LinearLayout.LayoutParams topParams=new LinearLayout.LayoutParams(-1,-2);topParams.bottomMargin=dp(3);
        page.addView(top,topParams);
        TextView subtitle=uiText("GAME LAUNCHER  ·  게임과 이미지 서비스를 한곳에서",11,Color.rgb(111,118,125),false);
        subtitle.setLetterSpacing(0.025f);page.addView(subtitle);

        LinearLayout statusCard=uiCard();
        LinearLayout.LayoutParams statusParams=new LinearLayout.LayoutParams(-1,-2);
        statusParams.topMargin=dp(13);statusParams.bottomMargin=dp(16);page.addView(statusCard,statusParams);
        status=uiText("런처 상태 확인 중",12,Color.rgb(35,39,43),true);
        statusCard.addView(status);
        folderText=uiText("",11,Color.rgb(113,120,127),false);
        LinearLayout.LayoutParams folderParams=new LinearLayout.LayoutParams(-1,-2);folderParams.topMargin=dp(6);
        statusCard.addView(folderText,folderParams);

        LinearLayout gameHeader=new LinearLayout(this);gameHeader.setGravity(android.view.Gravity.CENTER_VERTICAL);
        TextView gamesTitle=uiText("내 게임",16,Color.rgb(27,30,34),true);
        gameHeader.addView(gamesTitle,new LinearLayout.LayoutParams(0,-2,1f));
        profileSummary=uiText("0개",11,Color.rgb(111,118,125),false);gameHeader.addView(profileSummary);
        LinearLayout.LayoutParams gameHeaderParams=new LinearLayout.LayoutParams(-1,-2);
        gameHeaderParams.bottomMargin=dp(8);page.addView(gameHeader,gameHeaderParams);
        profileList=new LinearLayout(this);profileList.setOrientation(LinearLayout.VERTICAL);page.addView(profileList);

        LinearLayout imageCard=uiCard();
        LinearLayout.LayoutParams imageCardParams=new LinearLayout.LayoutParams(-1,-2);
        imageCardParams.topMargin=dp(14);imageCardParams.bottomMargin=dp(14);
        page.addView(imageCard,imageCardParams);
        imageCard.addView(uiText("IMAGE",9,Color.rgb(128,135,142),true));
        gap(imageCard,5);imageCard.addView(uiText("이미지 생성",15,Color.rgb(27,30,34),true));
        imageGenStatus=uiText("서버 상태 확인 중",11,Color.rgb(109,117,125),false);
        imageGenStatus.setMaxLines(3);
        LinearLayout.LayoutParams imageStatusParams=new LinearLayout.LayoutParams(-1,dp(43));imageStatusParams.topMargin=dp(5);
        imageCard.addView(imageGenStatus,imageStatusParams);
        LinearLayout.LayoutParams providerButtonParams=new LinearLayout.LayoutParams(-1,dp(38));providerButtonParams.topMargin=dp(4);
        imageCard.addView(compactButton("서비스 관리",true,()->startActivity(new Intent(MainActivity.this,ImageProviderActivity.class))),providerButtonParams);
        LinearLayout.LayoutParams panelButtonParams=new LinearLayout.LayoutParams(-1,dp(36));panelButtonParams.topMargin=dp(5);
        imageCard.addView(compactButton("설정 패널",false,this::openImageGenPanel),panelButtonParams);

        LinearLayout advancedCard=uiCard();
        LinearLayout.LayoutParams advancedParams=new LinearLayout.LayoutParams(-1,-2);page.addView(advancedCard,advancedParams);
        LinearLayout advancedHeader=new LinearLayout(this);advancedHeader.setGravity(android.view.Gravity.CENTER_VERTICAL);
        TextView advancedTitle=uiText("고급 도구",14,Color.rgb(33,37,41),true);
        advancedHeader.addView(advancedTitle,new LinearLayout.LayoutParams(0,-2,1f));
        Button expand=compactButton("펼치기  +",false,()->{});
        advancedHeader.addView(expand,new LinearLayout.LayoutParams(dp(88),dp(34)));
        advancedCard.addView(advancedHeader);
        LinearLayout advancedContent=new LinearLayout(this);advancedContent.setOrientation(LinearLayout.VERTICAL);
        LinearLayout.LayoutParams advancedContentParams=new LinearLayout.LayoutParams(-1,-2);
        advancedContentParams.topMargin=dp(10);advancedCard.addView(advancedContent,advancedContentParams);
        advancedContent.setVisibility(View.GONE);
        expand.setOnClickListener(v->{
            boolean show=advancedContent.getVisibility()!=View.VISIBLE;
            advancedContent.setVisibility(show?View.VISIBLE:View.GONE);
            expand.setText(show?"접기  −":"펼치기  +");
        });
        TextView advancedHint=uiText("일반 실행에는 필요하지 않은 서버 제어와 진단 도구입니다.",11,Color.rgb(111,118,125),false);
        advancedContent.addView(advancedHint);
        LinearLayout.LayoutParams launcherProviderParams=new LinearLayout.LayoutParams(-1,dp(40));launcherProviderParams.topMargin=dp(8);
        advancedContent.addView(compactButton("Image Studio에 런처 서비스 연결",true,this::startLauncherProviderServer),launcherProviderParams);
        LinearLayout.LayoutParams novelParams=new LinearLayout.LayoutParams(-1,dp(40));novelParams.topMargin=dp(6);
        advancedContent.addView(compactButton("NovelAI 서버 시작",false,this::startNovelAiServer),novelParams);
        comfyUrlInput=new EditText(this);comfyUrlInput.setSingleLine(true);comfyUrlInput.setTextSize(12);
        comfyUrlInput.setTextColor(Color.rgb(35,39,43));comfyUrlInput.setHintTextColor(Color.rgb(143,149,155));
        comfyUrlInput.setHint("ComfyUI 주소 · http://PC-IP:8188");
        comfyUrlInput.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_URI);
        comfyUrlInput.setPadding(dp(11),dp(7),dp(11),dp(7));
        comfyUrlInput.setBackground(uiShape(Color.WHITE,Color.rgb(221,225,229),10));
        comfyUrlInput.setText(getSharedPreferences(PREFS,MODE_PRIVATE).getString(KEY_COMFY_URL,""));
        LinearLayout.LayoutParams comfyInputParams=new LinearLayout.LayoutParams(-1,dp(44));
        comfyInputParams.topMargin=dp(7);advancedContent.addView(comfyUrlInput,comfyInputParams);
        LinearLayout.LayoutParams comfyStartParams=new LinearLayout.LayoutParams(-1,dp(40));
        comfyStartParams.topMargin=dp(6);
        advancedContent.addView(compactButton("ComfyUI 연결 서버 시작",false,this::startComfyConnectionServer),comfyStartParams);
        LinearLayout advancedActions=new LinearLayout(this);advancedActions.setOrientation(LinearLayout.HORIZONTAL);
        LinearLayout.LayoutParams advancedActionsParams=new LinearLayout.LayoutParams(-1,dp(40));
        advancedActionsParams.topMargin=dp(6);advancedContent.addView(advancedActions,advancedActionsParams);
        Button diagnostics=compactButton("전달 진단",false,()->startActivity(new Intent(MainActivity.this,ImageDiagnosticsActivity.class)));
        advancedActions.addView(diagnostics,new LinearLayout.LayoutParams(0,-1,1f));
        Button stop=compactButton("서버 중지",false,this::stopImageGenServer);
        LinearLayout.LayoutParams stopParams=new LinearLayout.LayoutParams(0,-1,1f);stopParams.leftMargin=dp(6);
        advancedActions.addView(stop,stopParams);
        home=page;root.addView(scroll,new FrameLayout.LayoutParams(-1,-1));setContentView(root);LauncherWindowInsets.apply(root);
        renderProfiles();refreshStatus();refreshImageGenStatus();
    }

    private void showLauncherInfoDialog(){
        new android.app.AlertDialog.Builder(this)
                .setTitle("런처 안내")
                .setMessage("게임 폴더는 읽기 권한으로 연결해 원본 파일을 직접 수정하지 않습니다. 등록한 게임은 각각 독립된 실행 세션으로 열립니다.")
                .setPositiveButton("확인",null).show();
    }
    private void chooseFolder(){
        Intent i=new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION|Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION|Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
        if(treeUri!=null)i.putExtra(DocumentsContract.EXTRA_INITIAL_URI,treeUri);
        else if(!profiles.isEmpty())try{i.putExtra(DocumentsContract.EXTRA_INITIAL_URI,Uri.parse(profiles.get(profiles.size()-1).uri));}catch(Exception ignored){}
        DiagnosticsLogger.event(this,"INFO","launcher","folder_picker_opened",null);
        startActivityForResult(i,PICK_TREE);
    }

    @Override protected void onActivityResult(int req,int result,Intent data){
        super.onActivityResult(req,result,data);
        if(req==WebFileChooser.REQUEST_CODE){
            if(webFileChooser!=null)webFileChooser.handleActivityResult(result,data);
            return;
        }
        if(req==PICK_TREE){
            if(result!=RESULT_OK||data==null||data.getData()==null){
                DiagnosticsLogger.event(this,"WARN","launcher","folder_picker_cancelled",null);
                return;
            }
            Uri picked=data.getData();int flags=data.getFlags()&(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            try{
                getContentResolver().takePersistableUriPermission(picked,flags);
                DiagnosticsLogger.event(this,"INFO","launcher","folder_permission_persisted",null);
                String value=picked.toString();GameProfile profile=findProfileByUri(value);
                if(profile==null){
                    String name=new SafTree(picked).rootName();
                    profile=new GameProfile(UUID.randomUUID().toString().replace("-",""),value,name);
                    profiles.add(profile);
                }
                activeProfileId=profile.id;treeUri=picked;tree=new SafTree(picked);saveProfiles();
                refreshStatus();renderProfiles();
                DiagnosticsLogger.event(this,"INFO","launcher","game_folder_registered",null);
                Toast.makeText(this,"게임 폴더를 등록했습니다. 목록에서 실행할 수 있습니다.",Toast.LENGTH_LONG).show();
            }catch(Exception e){DiagnosticsLogger.error(this,"launcher","folder_permission_failed",e);status("폴더 권한 저장 실패: "+msg(e));}
            return;
        }
    }

    private long getZipRevision(){return getSharedPreferences(PREFS,MODE_PRIVATE).getLong(KEY_ZIP_REV,0);}

    private void loadProfiles(){
        profiles.clear();
        String raw=getSharedPreferences(PREFS,MODE_PRIVATE).getString(KEY_PROFILES,null);
        if(raw!=null)try{
            JSONArray a=new JSONArray(raw);
            for(int i=0;i<a.length();i++){
                JSONObject p=a.optJSONObject(i);if(p==null)continue;
                String id=p.optString("id",""),uri=p.optString("uri",""),label=p.optString("label","Wayward");
                if(id.matches("[a-f0-9]{32}")&&!uri.isEmpty())profiles.add(new GameProfile(id,uri,label));
            }
        }catch(Exception ignored){}
        if(profiles.isEmpty()){
            String legacy=getSharedPreferences(PREFS,MODE_PRIVATE).getString(KEY_TREE,null);
            if(legacy!=null)try{
                Uri u=Uri.parse(legacy);profiles.add(new GameProfile(UUID.randomUUID().toString().replace("-",""),legacy,new SafTree(u).rootName()));saveProfiles();
            }catch(Exception ignored){}
        }
    }

    private void saveProfiles(){
        JSONArray a=new JSONArray();
        try{for(GameProfile p:profiles){JSONObject o=new JSONObject();o.put("id",p.id);o.put("uri",p.uri);o.put("label",p.label);a.put(o);}}
        catch(Exception ignored){}
        getSharedPreferences(PREFS,MODE_PRIVATE).edit().putString(KEY_PROFILES,a.toString()).remove(KEY_TREE).apply();
    }

    private GameProfile findProfile(String id){for(GameProfile p:profiles)if(p.id.equals(id))return p;return null;}
    private GameProfile findProfileByUri(String uri){for(GameProfile p:profiles)if(p.uri.equals(uri))return p;return null;}
    private String sessionProfileId(Intent intent){
        Uri u=intent==null?null:intent.getData();
        if(u==null||!"wayward".equals(u.getScheme())||!"session".equals(u.getHost()))return null;
        String id=u.getLastPathSegment();return id!=null&&id.matches("[a-f0-9]{32}")?id:null;
    }
    private String sessionDomain(String id){
        return "localhost";
    }
    private int sessionPort(String id){
        return 10000 + Math.floorMod((id == null ? "default" : id).hashCode(), 50000);
    }
    private String sessionOrigin(String id){
        return "https://" + sessionDomain(id) + ":" + sessionPort(id);
    }

    private void launchProfileSession(String id){
        Intent i=new Intent(this,MainActivity.class);i.setData(Uri.parse("wayward://session/"+Uri.encode(id)));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_DOCUMENT);startActivity(i);
    }

    private void openProfileSession(String id){
        DiagnosticsLogger.event(this,"INFO","launcher","game_session_open_requested",null);
        GameProfile p=findProfile(id);
        if(p==null){status("등록된 게임 폴더를 찾지 못했습니다. 홈에서 다시 등록해 주세요.");return;}
        try{
            if(web!=null)destroyWeb();
            activeProfileId=p.id;treeUri=Uri.parse(p.uri);tree=new SafTree(treeUri);
            String file=gameFile();if(file==null){DiagnosticsLogger.event(this,"ERROR","launcher","game_html_not_found",null);status("선택한 폴더에서 Wayward HTML을 찾지 못했습니다: "+p.label);return;}
            setTitle("Wayward · "+p.label);
            RUNNING_SESSIONS.add(p.id);
            if(home!=null)home.setVisibility(View.GONE);
            loadedZipRevision=getZipRevision();
            createWeb();web.setVisibility(View.VISIBLE);
            registerSessionActivity();
            String gameUrl=sessionOrigin(activeProfileId)+"/game/"+Uri.encode(file)+"?launcher="+System.currentTimeMillis();
            SafTree sessionTree=tree;
            web.setVisibility(View.VISIBLE);
            DiagnosticsLogger.event(this,"INFO","launcher","game_webview_load_requested",null);
            web.loadUrl(gameUrl);
            // Image Studio is optional: its startup must never gate the game page.
            ensureImageGenServer(sessionTree,()->{
                if(web==null||!activeProfileId.equals(id))return;
                refreshImageGenStatus();
            });
        }catch(Exception e){DiagnosticsLogger.error(this,"launcher","game_session_open_failed",e);status("게임 실행 실패: "+msg(e));}
    }

    private void removeProfile(String id){
        if(RUNNING_SESSIONS.contains(id)){
            Toast.makeText(this,"실행 중인 세션은 먼저 게임 화면에서 나간 뒤 삭제해 주세요.",Toast.LENGTH_LONG).show();return;
        }
        for(int i=profiles.size()-1;i>=0;i--)if(profiles.get(i).id.equals(id))profiles.remove(i);
        saveProfiles();renderProfiles();refreshStatus();
    }

    private void renderProfiles(){
        if(profileList==null)return;
        profileList.removeAllViews();
        if(profileSummary!=null)profileSummary.setText(profiles.size()+"개 등록");
        if(profiles.isEmpty()){
            LinearLayout empty=uiCard();
            empty.addView(uiText("등록된 게임이 없습니다.",13,Color.rgb(44,48,52),true));
            LinearLayout.LayoutParams hintParams=new LinearLayout.LayoutParams(-1,-2);hintParams.topMargin=dp(4);
            empty.addView(uiText("상단의 폴더 추가를 눌러 Wayward 또는 Faith 폴더를 선택하세요.",11,Color.rgb(112,119,126),false),hintParams);
            profileList.addView(empty);return;
        }
        for(GameProfile p:profiles){
            LinearLayout card=new LinearLayout(this);card.setOrientation(LinearLayout.HORIZONTAL);
            card.setGravity(android.view.Gravity.CENTER_VERTICAL);
            card.setPadding(dp(11),dp(7),dp(7),dp(7));
            card.setBackground(uiShape(Color.WHITE,Color.rgb(229,232,235),14));
            LinearLayout.LayoutParams cardParams=new LinearLayout.LayoutParams(-1,-2);cardParams.bottomMargin=dp(6);
            profileList.addView(card,cardParams);
            LinearLayout identity=new LinearLayout(this);identity.setOrientation(LinearLayout.VERTICAL);
            TextView name=uiText(p.label,14,Color.rgb(30,34,38),true);name.setMaxLines(1);
            identity.addView(name);
            TextView meta=uiText(p.id.equals(activeProfileId)?"현재 선택된 게임":"등록된 게임 폴더",10,Color.rgb(124,131,138),false);
            LinearLayout.LayoutParams metaParams=new LinearLayout.LayoutParams(-1,-2);metaParams.topMargin=dp(3);
            identity.addView(meta,metaParams);
            card.addView(identity,new LinearLayout.LayoutParams(0,dp(42),1f));
            Button start=compactButton("실행",true,()->launchProfileSession(p.id));
            card.addView(start,new LinearLayout.LayoutParams(dp(66),dp(38)));
            Button more=compactButton("⋯",false,()->showProfileActions(p));
            LinearLayout.LayoutParams moreParams=new LinearLayout.LayoutParams(dp(40),dp(38));moreParams.leftMargin=dp(5);
            card.addView(more,moreParams);
        }
    }

    private void showProfileActions(GameProfile profile){
        new android.app.AlertDialog.Builder(this).setTitle(profile.label)
                .setItems(new String[]{"게임 실행","폴더 등록 해제"},(dialog,which)->{
                    if(which==0)launchProfileSession(profile.id);
                    else new android.app.AlertDialog.Builder(this).setTitle("게임 폴더 등록 해제")
                            .setMessage(profile.label+" 폴더를 런처 목록에서 제거할까요? 게임 원본 파일은 삭제되지 않습니다.")
                            .setNegativeButton("취소",null)
                            .setPositiveButton("등록 해제",(confirm,button)->removeProfile(profile.id)).show();
                }).setNegativeButton("닫기",null).show();
    }

    private String gameFile(){
        if(tree==null)return null;
        if(tree.exists(KO))return KO;if(tree.exists(EN))return EN;if(tree.exists("index.html"))return "index.html";
        try{
            List<String> names=tree.rootHtmlFiles();Collections.sort(names,String.CASE_INSENSITIVE_ORDER);
            for(String name:names)if(name.toLowerCase(Locale.ROOT).startsWith("wayward_faith"))return name;
            for(String name:names)if(name.toLowerCase(Locale.ROOT).startsWith("wayward"))return name;
            return names.size()==1?names.get(0):null;
        }catch(Exception ignored){return null;}
    }
    private List<String> allModIds(){
        Set<String> ids=new TreeSet<>();
        if(tree!=null)try{ids.addAll(tree.listModIds());}catch(Exception ignored){}
        if(zipMods!=null)ids.addAll(zipMods.listModIds());
        return new ArrayList<>(ids);
    }
    private void refreshStatus(){
        if(tree==null){
            status("준비 완료  ·  게임 "+profiles.size()+"개");
            if(folderText!=null)folderText.setText("게임 폴더를 등록하면 여기에서 상태를 확인할 수 있습니다.");
            return;
        }
        try{
            String f=gameFile();
            status(f==null?"선택한 폴더에서 게임 HTML을 찾지 못했습니다.":"게임 폴더 확인 완료  ·  WML 모드 "+allModIds().size()+"개");
            if(folderText!=null)folderText.setText(tree.rootName()+"  ·  "+(f==null?"실행 파일 없음":f));
        }catch(Exception e){
            status("폴더를 읽을 수 없습니다. "+msg(e));
        }
    }
    private void refreshGame(){if(web!=null&&web.getVisibility()==View.VISIBLE){if(tree!=null)tree.invalidateDirectoryIndex();web.clearCache(true);web.reload();Toast.makeText(this,"게임 파일과 이미지 캐시를 새로 읽습니다.",Toast.LENGTH_SHORT).show();}else refreshStatus();}

    private void createWeb(){
        String domain=sessionDomain(activeProfileId);
        String origin=sessionOrigin(activeProfileId);
        int originPort=sessionPort(activeProfileId);
        web=new WebView(this);WebSettings s=web.getSettings();s.setJavaScriptEnabled(true);s.setDomStorageEnabled(true);s.setDatabaseEnabled(true);s.setUseWideViewPort(true);s.setLoadWithOverviewMode(true);s.setTextZoom(100);s.setSupportZoom(true);s.setBuiltInZoomControls(false);s.setDisplayZoomControls(false);s.setAllowFileAccess(false);s.setAllowContentAccess(false);s.setCacheMode(WebSettings.LOAD_DEFAULT);s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);web.addJavascriptInterface(new HostBridge(),"WMLHost");
        installImageGenDocumentStartScript(origin);
        FolderHandler folderHandler=new FolderHandler(tree,getAssets(),zipMods,origin);
        WebViewAssetLoader loader=new WebViewAssetLoader.Builder().setDomain(domain+":"+originPort).addPathHandler("/game/",folderHandler).build();
        final java.util.concurrent.atomic.AtomicInteger imageDiagnostics=new java.util.concurrent.atomic.AtomicInteger();
        final java.util.LinkedHashMap<String,Integer> imageHttpErrorCounts=new java.util.LinkedHashMap<>();
        web.setWebViewClient(new WebViewClient(){
            @Override public void onPageStarted(WebView view,String url,android.graphics.Bitmap favicon){
                DiagnosticsLogger.event(MainActivity.this,"INFO","webview","page_started",null);
                super.onPageStarted(view,url,favicon);
            }
            @Override public void onPageFinished(WebView view,String url){
                DiagnosticsLogger.event(MainActivity.this,"INFO","webview","page_finished",null);
                super.onPageFinished(view,url);
            }
            @Override public void onReceivedError(WebView view,WebResourceRequest request,android.webkit.WebResourceError error){
                if(request!=null&&!request.isForMainFrame()){
                    Uri failedUri=request.getUrl();
                    String failedPath=failedUri==null?null:failedUri.getPath();
                    if(isImageResourcePath(failedPath)){
                        JSONObject pipeline=new JSONObject();
                        try{
                            pipeline.put("networkErrorCode",error==null?0:error.getErrorCode());
                            pipeline.put("srcKind",failedUri!=null&&domain.equalsIgnoreCase(failedUri.getHost())?"game_asset":"external");
                            ImagePipelineDiagnostics.addSanitizedUrl(pipeline,failedUri==null?null:failedUri.toString());
                        }catch(Exception ignored){}
                        ImagePipelineDiagnostics.record(MainActivity.this,"webview_image_network_error",pipeline);
                    }
                }
                if(request!=null&&request.isForMainFrame()){
                    JSONObject details=new JSONObject();
                    try{details.put("code",error==null?0:error.getErrorCode());}catch(Exception ignored){}
                    DiagnosticsLogger.event(MainActivity.this,"ERROR","webview","main_frame_load_error",details);
                }
                super.onReceivedError(view,request,error);
            }
            @Override public void onReceivedHttpError(WebView view,WebResourceRequest request,WebResourceResponse response){
                if(request!=null&&response!=null&&response.getStatusCode()>=400){
                    Uri failedUri=request.getUrl();
                    String failedPath=failedUri==null?null:failedUri.getPath();
                    boolean imageResource=isImageResourcePath(failedPath);
                    boolean handledByLocalImageLogger=failedPath!=null&&(
                            (domain.equalsIgnoreCase(failedUri.getHost())&&FolderHandler.isImageRequestPath(failedPath))
                            ||("art.sintention.com".equalsIgnoreCase(failedUri.getHost())
                                &&FolderHandler.isLocalOnlyCharacterImagePath(failedPath)));
                    if(imageResource){
                        String safePath=ImagePipelineDiagnostics.sanitizePath(failedPath);
                        String sampleKey=(failedUri==null?"":String.valueOf(failedUri.getHost()))+"|"+safePath;
                        int repeatCount;
                        synchronized(imageHttpErrorCounts){
                            Integer previous=imageHttpErrorCounts.get(sampleKey);
                            repeatCount=previous==null?1:previous+1;
                            if(previous==null&&imageHttpErrorCounts.size()>=256){
                                String oldest=imageHttpErrorCounts.keySet().iterator().next();
                                imageHttpErrorCounts.remove(oldest);
                            }
                            imageHttpErrorCounts.put(sampleKey,repeatCount);
                        }
                        if(repeatCount<=2||repeatCount%10==0){
                            JSONObject pipeline=new JSONObject();
                            try{
                                pipeline.put("responseStatus",response.getStatusCode());
                                pipeline.put("srcKind",domain.equalsIgnoreCase(failedUri.getHost())?"game_asset":"external");
                                pipeline.put("repeatCount",repeatCount);
                                ImagePipelineDiagnostics.addSanitizedUrl(pipeline,failedUri==null?null:failedUri.toString());
                            }catch(Exception ignored){}
                            ImagePipelineDiagnostics.record(MainActivity.this,"webview_image_http_error",pipeline);
                        }
                    }
                    if(imageResource&&!handledByLocalImageLogger&&imageDiagnostics.getAndIncrement()<16){
                        JSONObject details=new JSONObject();
                        try{
                            details.put("host",failedUri==null?"":failedUri.getHost());
                            details.put("path",ImagePipelineDiagnostics.sanitizePath(failedPath));
                            details.put("status",response.getStatusCode());
                            details.put("mainFrame",request.isForMainFrame());
                        }catch(Exception ignored){}
                        DiagnosticsLogger.event(MainActivity.this,"WARN","webview","image_http_error",details);
                    }else if(request.isForMainFrame()){
                        JSONObject details=new JSONObject();
                        try{details.put("status",response.getStatusCode());}catch(Exception ignored){}
                        DiagnosticsLogger.event(MainActivity.this,"WARN","webview","main_frame_http_error",details);
                    }
                }
                super.onReceivedHttpError(view,request,response);
            }
            @Override public boolean onRenderProcessGone(WebView view,android.webkit.RenderProcessGoneDetail detail){
                JSONObject details=new JSONObject();
                try{details.put("didCrash",detail!=null&&detail.didCrash());details.put("priority",detail==null?-1:detail.rendererPriorityAtExit());}catch(Exception ignored){}
                DiagnosticsLogger.event(MainActivity.this,"ERROR","webview","renderer_process_gone",details);
                return super.onRenderProcessGone(view,detail);
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView v,WebResourceRequest r){
                Uri u=r.getUrl();
                WebResourceResponse local=loader.shouldInterceptRequest(u);
                if(local!=null)return local;
                if(domain.equalsIgnoreCase(u.getHost())&&u.getPort()==originPort){
                    String path=u.getPath();
                    if(FolderHandler.isGameRequestPath(path)){
                        if(r.isForMainFrame()){
                            JSONObject details=new JSONObject();
                            try{details.put("authority",u.getAuthority());details.put("path",path);}catch(Exception ignored){}
                            DiagnosticsLogger.event(MainActivity.this,"WARN","webview","asset_loader_direct_fallback",details);
                        }
                        return folderHandler.serveGamePath(path.substring(6));
                    }
                    if(path != null && path.startsWith("/images/__wayward_generated__/"))
                        return serveGeneratedImageRequest(path, imageDiagnostics);
                    if(FolderHandler.isImageRequestPath(path))return serveImageRequest(folderHandler,path,imageDiagnostics);
                }
                if("art.sintention.com".equalsIgnoreCase(u.getHost())){
                    String path=u.getPath();
                    // Generated WML character images are local-only; never fall back to the CDN.
                    if(FolderHandler.isLocalOnlyCharacterImagePath(path))return serveImageRequest(folderHandler,path,imageDiagnostics);
                    // Preserve the existing CDN fallback for all other image resources.
                    if(FolderHandler.isImageRequestPath(path))return folderHandler.serveExternalImagePath(path.substring(8));
                }
                return null;
            }
            @Override public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest r){
                Uri u=r.getUrl();if(domain.equalsIgnoreCase(u.getHost())&&u.getPort()==originPort)return false;
                String p=u.getScheme();if("https".equalsIgnoreCase(p)||"http".equalsIgnoreCase(p)||"mailto".equalsIgnoreCase(p)){try{startActivity(new Intent(Intent.ACTION_VIEW,u));return true;}catch(Exception ignored){return false;}}return true;
            }
        });
        webFileChooser=new WebFileChooser(this);web.setWebChromeClient(webFileChooser);root.addView(web,new FrameLayout.LayoutParams(-1,-1));web.setVisibility(View.GONE);
    }

    private static boolean isImageResourcePath(String path){
        if(path==null)return false;
        String lower=path.toLowerCase(Locale.ROOT);
        return FolderHandler.isImageRequestPath(path)
                ||lower.endsWith(".png")||lower.endsWith(".jpg")||lower.endsWith(".jpeg")
                ||lower.endsWith(".webp")||lower.endsWith(".gif")||lower.endsWith(".avif")
                ||lower.endsWith(".svg");
    }

    private WebResourceResponse serveImageRequest(FolderHandler handler,String path,
                                                       java.util.concurrent.atomic.AtomicInteger samples){
        long started=System.nanoTime();
        WebResourceResponse response=handler.serveImagePath(path.substring(8));
        long elapsedMs=(System.nanoTime()-started)/1_000_000L;
        int status=response==null?0:response.getStatusCode();
        if(response!=null&&(status>=400||elapsedMs>=350)&&samples.getAndIncrement()<16){
            JSONObject details=new JSONObject();
            try{
                details.put("path",ImagePipelineDiagnostics.sanitizePath(path));
                details.put("status",status);
                details.put("elapsedMs",elapsedMs);
            }catch(Exception ignored){}
            JSONObject pipeline=new JSONObject();
            try{
                pipeline.put("responseStatus",status);
                pipeline.put("elapsedMs",elapsedMs);
                pipeline.put("srcKind","game_asset");
                ImagePipelineDiagnostics.addSanitizedPath(pipeline,path);
            }catch(Exception ignored){}
            ImagePipelineDiagnostics.record(this,status>=400?"webview_image_resource_error":"webview_image_resource_slow",pipeline);
            DiagnosticsLogger.event(this,"WARN","webview","image_resource_slow_or_failed",details);
        }
        return response;
    }


    /**
     * Serves ImageGen's app-private cache under the HTTPS game origin.
     * The managed Bun server is HTTP loopback-only, so its /images URL cannot
     * be used directly by this HTTPS WebView (mixed content is disabled).
     */
    private WebResourceResponse serveGeneratedImageRequest(
            String requestPath, java.util.concurrent.atomic.AtomicInteger samples) {
        final String prefix = "/images/__wayward_generated__/";
        if (requestPath == null || !requestPath.startsWith(prefix)) {
            return generatedImageError(404, "Not Found", requestPath);
        }
        try {
            String relative = FolderHandler.normal(requestPath.substring(prefix.length()));
            if (relative == null) return generatedImageError(400, "Bad Request", requestPath);

            String mime = FolderHandler.mime(relative);
            if (!("image/png".equals(mime) || "image/jpeg".equals(mime)
                    || "image/webp".equals(mime) || "image/gif".equals(mime)
                    || "image/avif".equals(mime))) {
                return generatedImageError(415, "Unsupported Media Type", requestPath);
            }

            File root = new File(getFilesDir(), "imagegen/images").getCanonicalFile();
            File image = new File(root, relative).getCanonicalFile();
            String rootPrefix = root.getPath() + File.separator;
            if (!image.getPath().startsWith(rootPrefix)) {
                return generatedImageError(403, "Forbidden", requestPath);
            }
            if (!image.isFile()) return generatedImageError(404, "Not Found", requestPath);
            long length = image.length();
            if (length <= 0 || length > 25L * 1024L * 1024L) {
                return generatedImageError(413, "Content Too Large", requestPath);
            }

            java.util.HashMap<String, String> headers = new java.util.HashMap<>();
            headers.put("Cache-Control", "no-store");
            headers.put("X-Content-Type-Options", "nosniff");
            return new WebResourceResponse(mime, null, 200, "OK", headers, new java.io.FileInputStream(image));
        } catch (java.io.FileNotFoundException error) {
            return generatedImageError(404, "Not Found", requestPath);
        } catch (Exception error) {
            return generatedImageError(500, "Read Error", requestPath);
        }
    }

    private WebResourceResponse generatedImageError(int status, String reason, String requestPath) {
        try {
            JSONObject diagnostic = new JSONObject();
            diagnostic.put("srcKind", "generated_image");
            diagnostic.put("responseStatus", status);
            ImagePipelineDiagnostics.addSanitizedPath(diagnostic, requestPath);
            ImagePipelineDiagnostics.record(this, "webview_generated_image_resource_error", diagnostic);
        } catch (Exception ignored) {}
        byte[] body = "Generated image unavailable".getBytes(StandardCharsets.UTF_8);
        java.util.HashMap<String, String> headers = new java.util.HashMap<>();
        headers.put("Cache-Control", "no-store");
        headers.put("X-Content-Type-Options", "nosniff");
        return new WebResourceResponse("text/plain", "UTF-8", status, reason, headers,
                new ByteArrayInputStream(body));
    }

    private void installImageGenDocumentStartScript(String origin) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            if (imageGenStatus != null) imageGenStatus.setText("이 Android System WebView는 이미지 서버 연결 스크립트를 지원하지 않습니다. WebView 업데이트가 필요합니다.");
            return;
        }
        try {
            for (String assetName : new String[] {"imagegen-proxy.js", "image-provider-bridge.js", "imagegen-studio-bridge.js"}) {
                try (InputStream in = getAssets().open(assetName)) {
                    ByteArrayOutputStream out = new ByteArrayOutputStream();
                    byte[] buffer = new byte[8192];
                    int count;
                    while ((count = in.read(buffer)) >= 0) {
                        if (count > 0) out.write(buffer, 0, count);
                        if (out.size() > 64 * 1024) throw new IllegalStateException(assetName + " 파일이 너무 큽니다.");
                    }
                    String source = new String(out.toByteArray(), StandardCharsets.UTF_8);
                    WebViewCompat.addDocumentStartJavaScript(
                            web, source, Collections.singleton(origin));
                }
            }
        } catch (Exception e) {
            if (imageGenStatus != null) imageGenStatus.setText("이미지 생성 연결 스크립트를 준비하지 못했습니다: " + msg(e));
        }
    }

    private static final Object IMAGEGEN_LOCK = new Object();

    private File imageGenBackendRoot() {
        return new File(getFilesDir(), "imagegen/backend");
    }

    private String imageStudioModId(SafTree sessionTree) throws Exception {
        if (sessionTree != null) {
            String folderMod = sessionTree.imageStudioModId();
            if ("imagestudio".equals(folderMod)) return folderMod;
        }
        // ZIP-installed WML mods are served by the same overlay used by the
        // WebView. Detect the adapter there as well; never extract the ZIP.
        if (zipMods == null) return null;
        try (InputStream script = zipMods.open("wml/mods/imagestudio/mod.js")) {
            if (script == null) return null;
            byte[] bytes = new byte[65536];
            int used = 0;
            while (used < bytes.length) {
                int count = script.read(bytes, used, bytes.length - used);
                if (count < 0) break;
                if (count == 0) continue;
                used += count;
            }
            String source = new String(bytes, 0, used, StandardCharsets.UTF_8);
            int defineAt = source.indexOf("WML.define");
            if (defineAt < 0) return null;
            Matcher matcher = MOD_ID.matcher(source.substring(defineAt));
            return matcher.find() && "imagestudio".equals(matcher.group(1))
                    ? "imagestudio" : null;
        }
    }

    private boolean ensureImageGenBackend(SafTree sessionTree) throws Exception {
        // The WML mod is only the in-game adapter. The server implementation is
        // shipped in the launcher APK and never copied from the selected game.
        if (!"imagestudio".equals(imageStudioModId(sessionTree))) return false;
        File backend = ImageGenBackendInstaller.install(this, imageGenBackendRoot());
        return hasImageGenProject(backend);
    }

    private boolean hasImageGenProject(File backend) {
        File nested = new File(backend, "wayward-imagegen");
        File project = new File(nested, "src/cli.ts").isFile() ? nested : backend;
        return new File(project, "package.json").isFile() && new File(project, "src/cli.ts").isFile();
    }

    private void ensureImageGenServer(SafTree sessionTree, Runnable afterReady) {
        if (afterReady != null) imageGenReadyCallbacks.add(afterReady);
        if (sessionTree == null) {
            imageGenSessionMessage = "현재 게임 세션의 폴더를 확인할 수 없어 이미지 서버 자동 시작을 건너뛰었습니다.";
            finishImageGenCallbacks();
            refreshImageGenStatus();
            return;
        }

        if (manualImageGenPreparing) {
            imageGenSessionMessage = "이미지 생성 서버 준비가 진행 중입니다. 준비가 끝난 뒤 현재 세션을 다시 여세요.";
            refreshImageGenStatus();
            finishImageGenCallbacks();
            return;
        }
        if (imageGenCopying) {
            waitForImageGenReady();
            return;
        }

        final String providerMode;
        final String providerProfileId;
        final String providerId;
        final String version;
        try {
            String detected = imageStudioModId(sessionTree);
            imageStudioSessionDetected = "imagestudio".equals(detected);
            if (detected == null) {
                imageGenSessionMessage = "현재 세션의 WML Image Studio 모드가 없어 이미지 서버를 시작하지 않았습니다.";
                refreshImageGenStatus();
                finishImageGenCallbacks();
                return;
            }
            String selectedMode = "novelai";
            String selectedProfile = "";
            String selectedProvider = "";
            if (activeProfileId != null && activeProfileId.matches("[a-f0-9]{32}")) {
                ImageProviderStore.Snapshot providers = new ImageProviderStore(this).load();
                String defaultId = providers.defaults.get(activeProfileId);
                if (defaultId != null && !defaultId.trim().isEmpty()) {
                    ImageProviderStore.Provider selected = ImageProviderStore.find(providers, defaultId);
                    if (selected == null) {
                        throw new IllegalStateException("이 게임의 기본 이미지 서비스를 찾지 못했습니다. 런처의 이미지 서비스 설정에서 다시 지정해 주세요.");
                    }
                    if (!selected.enabled) {
                        throw new IllegalStateException("이 게임의 기본 이미지 서비스가 비활성화되었습니다. 이미지 서비스 목록에서 다시 활성화해 주세요.");
                    }
                    if (!selected.allowInGame) {
                        throw new IllegalStateException("기본 이미지 서비스의 인게임 사용이 차단되어 있습니다. 이미지 서비스 화면에서 '인게임 생성 연결 허용'을 눌러 주세요.");
                    }
                    selectedMode = "launcher";
                    selectedProfile = activeProfileId;
                    selectedProvider = selected.id;
                }
            }
            providerMode = selectedMode;
            providerProfileId = selectedProfile;
            providerId = selectedProvider;
            version = "launcher-imagegen:" + ImageGenBackendInstaller.VERSION + ":" + providerMode
                    + ("launcher".equals(providerMode) ? ":" + providerProfileId + ":" + providerId : "");
        } catch (Exception e) {
            imageGenSessionMessage = "현재 세션의 Image Studio / 이미지 서비스 확인 실패: " + msg(e);
            refreshImageGenStatus();
            finishImageGenCallbacks();
            return;
        }

        ImageGenStatusStore.State shared = ImageGenStatusStore.read(getFilesDir());
        if (shared.isAvailable() || shared.isStarting()) {
            if (!sameImageGenVersion(shared.backendVersion, version)) {
                imageGenSessionMessage = "현재 세션 Image Studio 버전(" + version + ")이 실행 중 서버 버전("
                        + safeVersion(shared.backendVersion) + ")과 달라 공유하지 않았습니다. 실행 중인 서버를 중지한 뒤 세션을 다시 열어 주세요.";
                refreshImageGenStatus();
                finishImageGenCallbacks();
                return;
            }
            imageGenSessionMessage = "현재 세션의 Image Studio " + version + "을 공통 이미지 서버에 연결합니다.";
            waitForImageGenReady();
            return;
        }

        synchronized (IMAGEGEN_LOCK) {
            shared = ImageGenStatusStore.read(getFilesDir());
            if (shared.isAvailable() || shared.isStarting()) {
                if (!sameImageGenVersion(shared.backendVersion, version)) {
                    imageGenSessionMessage = "다른 세션에서 다른 Image Studio 버전의 서버가 실행 중입니다. 현재 서버를 중지한 뒤 다시 시도해 주세요.";
                    refreshImageGenStatus();
                    finishImageGenCallbacks();
                    return;
                }
                waitForImageGenReady();
                return;
            }
            if (imageGenCopying) {
                waitForImageGenReady();
                return;
            }
            imageGenCopying = true;
        }

        imageGenSessionMessage = "현재 세션의 Image Studio 백엔드를 확인하고 런처 서버에 연결하는 중입니다…";
        refreshImageGenStatus();
        new Thread(() -> {
            String problem = null;
            File backend = imageGenBackendRoot();
            try {
                synchronized (IMAGEGEN_LOCK) {
                    if (!ensureImageGenBackend(sessionTree)) {
                        throw new IllegalStateException("현재 런처 APK에 포함된 ImageGen 서버 자산을 찾지 못했습니다.");
                    }
                }
                writeImageGenRuntimeConfig(backend, providerMode, "", providerProfileId, providerId);
            } catch (Throwable error) {
                problem = error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage();
            }
            final String failure = problem;
            runOnUiThread(() -> {
                imageGenCopying = false;
                if (failure != null) {
                    imageGenSessionMessage = "Image Studio 백엔드 준비 실패: " + failure;
                    refreshImageGenStatus();
                    finishImageGenCallbacks();
                    return;
                }
                startImageGenService(backend, version, providerMode, "", providerProfileId, providerId);
                waitForImageGenReady();
            });
        }, "wayward-imagegen-session-prepare").start();
    }

    private static boolean sameImageGenVersion(String running, String requested) {
        if(running==null||requested==null||running.isEmpty()||requested.isEmpty())return false;
        // The engine mode and, for native providers, profile provider ID are
        // part of the identity so sessions cannot silently share another profile's service.
        return running.equals(requested);
    }

    private static String safeVersion(String version) {
        return version == null || version.isEmpty() ? "알 수 없음" : version;
    }

    private void waitForImageGenReady() {
        if (imageGenReadyCallbacks.isEmpty() || imageGenPollRunnable != null) return;
        final long deadline = System.currentTimeMillis() + 18L * 60L * 1000L;
        imageGenPollRunnable = new Runnable() {
            @Override public void run() {
                ImageGenStatusStore.State state = ImageGenStatusStore.read(getFilesDir());
                boolean finished = state.isReady() || state.isAvailable()
                        || (!state.isStarting() && !imageGenCopying)
                        || System.currentTimeMillis() >= deadline;
                if (finished) {
                    imageGenPollRunnable = null;
                    finishImageGenCallbacks();
                    refreshImageGenStatus();
                } else {
                    imageGenHandler.postDelayed(this, 500);
                }
            }
        };
        imageGenHandler.post(imageGenPollRunnable);
    }

    private void finishImageGenCallbacks() {
        if (imageGenPollRunnable != null) {
            imageGenHandler.removeCallbacks(imageGenPollRunnable);
            imageGenPollRunnable = null;
        }
        List<Runnable> callbacks = new ArrayList<>(imageGenReadyCallbacks);
        imageGenReadyCallbacks.clear();
        for (Runnable callback : callbacks) {
            try { callback.run(); } catch (Exception ignored) {}
        }
    }

    private void startLauncherProviderServer(){
        if(activeProfileId==null||!activeProfileId.matches("[a-f0-9]{32}")){
            Toast.makeText(this,"게임 프로필을 먼저 열어 주세요.",Toast.LENGTH_LONG).show();
            return;
        }
        try{
            ImageProviderStore.Snapshot snapshot=new ImageProviderStore(this).load();
            String providerId=snapshot.defaults.get(activeProfileId);
            ImageProviderStore.Provider provider=ImageProviderStore.find(snapshot,providerId);
            if(provider==null||!provider.enabled||!provider.allowInGame){
                Toast.makeText(this,"이 게임 프로필의 기본 이미지 서비스를 지정하고 '게임에서 사용 허용'을 켜 주세요.",Toast.LENGTH_LONG).show();
                return;
            }
            startOrSwitchManagedImageGenServer("launcher","");
        }catch(Exception error){
            imageGenSessionMessage="등록 이미지 서비스 확인 실패: "+msg(error);
            refreshImageGenStatus();
            Toast.makeText(this,imageGenSessionMessage,Toast.LENGTH_LONG).show();
        }
    }

    private void startNovelAiServer(){
        startOrSwitchManagedImageGenServer("novelai","");
    }

    private void startComfyConnectionServer(){
        try{
            String url=ComfyEndpoint.normalizeOptional(comfyUrlInput==null?"":comfyUrlInput.getText().toString());
            startOrSwitchManagedImageGenServer("comfy",url);
        }catch(IllegalArgumentException error){
            imageGenSessionMessage="ComfyUI 주소 확인: "+msg(error);
            refreshImageGenStatus();
            Toast.makeText(this,imageGenSessionMessage,Toast.LENGTH_LONG).show();
        }
    }

    private void startOrSwitchManagedImageGenServer(String mode,String endpoint){
        ImageGenStatusStore.State running=ImageGenStatusStore.read(getFilesDir());
        String storedEndpoint=getSharedPreferences(PREFS,MODE_PRIVATE).getString(KEY_COMFY_URL,"");
        boolean endpointChanged="comfy".equals(mode)&&!endpoint.equals(storedEndpoint==null?"":storedEndpoint);
        boolean sameMode=!"launcher".equals(mode)&&running.backendVersion!=null&&running.backendVersion.endsWith(":"+mode);
        if(running.isStarting()){
            imageGenSessionMessage="이미 이미지 서버를 시작하고 있습니다. 준비가 끝난 뒤 다시 시도해 주세요.";
            refreshImageGenStatus();
            return;
        }
        if(running.isAvailable()&&sameMode&&!endpointChanged){
            imageGenSessionMessage=running.isReady()
                    ? "런처 내장 "+("comfy".equals(mode)?"ComfyUI 중계":"NovelAI")+" 서버가 이미 실행 중입니다."
                    : (running.message.isEmpty() ? "이미지 서버 응답은 확인됐지만 공급자 설정이 아직 준비되지 않았습니다." : running.message);
            refreshImageGenStatus();
            Toast.makeText(this,imageGenSessionMessage,Toast.LENGTH_SHORT).show();
            return;
        }
        if("comfy".equals(mode)){
            getSharedPreferences(PREFS,MODE_PRIVATE).edit().putString(KEY_COMFY_URL,endpoint).apply();
        }
        if(running.isAvailable()){
            imageGenSessionMessage="서버 설정 변경을 적용하기 위해 내장 이미지 서버를 재시작합니다…";
            refreshImageGenStatus();
            stopImageGenServer();
            waitForImageGenStopThenStart(mode,endpoint,0);
            return;
        }
        startManagedImageGenServer(mode,endpoint);
    }

    private void waitForImageGenStopThenStart(String mode,String endpoint,int attempt){
        ImageGenStatusStore.State state=ImageGenStatusStore.read(getFilesDir());
        if(!state.isAvailable()&&!state.isStarting()){
            startManagedImageGenServer(mode,endpoint);
            return;
        }
        if(attempt>=20){
            imageGenSessionMessage="기존 이미지 서버가 아직 종료되지 않았습니다. 중지 버튼으로 종료한 뒤 다시 실행해 주세요.";
            refreshImageGenStatus();
            return;
        }
        imageGenHandler.postDelayed(()->waitForImageGenStopThenStart(mode,endpoint,attempt+1),250);
    }

    private void openImageGenPanel(){
        if (web == null || tree == null) {
            MainActivity session = findActiveSessionActivity();
            if (session != null && session != this) {
                String sessionId = session.activeProfileId;
                // The owner Activity is already alive in this process. Invoke its
                // settings action directly, then bring its document task forward.
                // Relying only on NEW_DOCUMENT/onNewIntent can reorder the task without
                // delivering the UI action on some Android document-task stacks.
                try {
                    session.openImageGenPanel();
                    Intent route = new Intent(this, MainActivity.class);
                    route.setData(Uri.parse("wayward://session/" + Uri.encode(sessionId)));
                    route.addFlags(Intent.FLAG_ACTIVITY_NEW_DOCUMENT | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
                    startActivity(route);
                    DiagnosticsLogger.event(this,"INFO","imagegen","session_settings_routed",null);
                    return;
                } catch (Throwable error) {
                    DiagnosticsLogger.error(this,"imagegen","session_settings_route_failed",error);
                }
            }
            Toast.makeText(this,"게임 세션을 먼저 실행해 Image Studio 모드를 불러와 주세요.",Toast.LENGTH_LONG).show();
            return;
        }
        Runnable openSettings = () -> {
            ImageGenStatusStore.State state = ImageGenStatusStore.read(getFilesDir());
            if (!state.isAvailable()) {
                String detail = state.message == null || state.message.isEmpty()
                        ? "이미지 서버 응답을 확인하지 못했습니다." : state.message;
                Toast.makeText(this,detail,Toast.LENGTH_LONG).show();
                return;
            }
            if (home != null) home.setVisibility(View.GONE);
            web.setVisibility(View.VISIBLE);
            web.bringToFront();
            web.postDelayed(() -> {
                if (web == null) return;
                web.evaluateJavascript(
                        "(async()=>{const bridge=window.WaywardLauncherImageStudio;"
                        + "if(!bridge)return 'launcher_bridge_missing';"
                        + "const result=await bridge.openGenerationSettings();"
                        + "return result&&result.ok?'opened':(result&&result.reason)||'open_failed';})()",
                        value -> {
                            if (value == null || !value.contains("opened")) {
                                String reason = value == null ? "unknown" : value;
                                Toast.makeText(this,"Image Studio 설정 화면을 열지 못했습니다: "+reason,Toast.LENGTH_LONG).show();
                            }
                        });
            }, 100L);
        };
        // A verified active session can reuse the running service without a
        // second SAF scan. Otherwise retain the normal detection/startup flow.
        ImageGenStatusStore.State existing = ImageGenStatusStore.read(getFilesDir());
        if (imageStudioSessionDetected && existing.isAvailable()) openSettings.run();
        else ensureImageGenServer(tree, openSettings);
    }

    private void registerSessionActivity() {
        String id = activeProfileId;
        if (id == null || !id.matches("[a-f0-9]{32}") || web == null || tree == null) return;
        SESSION_ACTIVITIES.put(id, new WeakReference<>(this));
        LAST_ACTIVE_SESSION_ID = id;
    }

    private static MainActivity findActiveSessionActivity() {
        String lastId = LAST_ACTIVE_SESSION_ID;
        if (lastId != null && !lastId.isEmpty()) {
            WeakReference<MainActivity> last = SESSION_ACTIVITIES.get(lastId);
            MainActivity activity = last == null ? null : last.get();
            if (activity != null && !activity.isFinishing()
                    && activity.web != null && activity.tree != null) return activity;
            if (last != null && activity == null) SESSION_ACTIVITIES.remove(lastId, last);
        }
        for (Map.Entry<String, WeakReference<MainActivity>> entry : SESSION_ACTIVITIES.entrySet()) {
            MainActivity activity = entry.getValue().get();
            if (activity != null && !activity.isFinishing()
                    && activity.web != null && activity.tree != null) {
                LAST_ACTIVE_SESSION_ID = entry.getKey();
                return activity;
            }
            if (activity == null) SESSION_ACTIVITIES.remove(entry.getKey(), entry.getValue());
        }
        LAST_ACTIVE_SESSION_ID = "";
        return null;
    }

    private void unregisterSessionActivity() {
        for (Map.Entry<String, WeakReference<MainActivity>> entry : SESSION_ACTIVITIES.entrySet()) {
            if (entry.getValue().get() == this) {
                SESSION_ACTIVITIES.remove(entry.getKey(), entry.getValue());
                if (entry.getKey().equals(LAST_ACTIVE_SESSION_ID)) LAST_ACTIVE_SESSION_ID = "";
            }
        }
        if (LAST_ACTIVE_SESSION_ID.isEmpty()) findActiveSessionActivity();
    }

    private void startManagedImageGenServer(String mode,String comfyUrl){
        if (!"novelai".equals(mode) && !"comfy".equals(mode) && !"launcher".equals(mode)) {
            imageGenSessionMessage = "지원하지 않는 이미지 생성 서버 모드입니다.";
            refreshImageGenStatus();
            return;
        }
        synchronized(IMAGEGEN_LOCK){
            ImageGenStatusStore.State running=ImageGenStatusStore.read(getFilesDir());
            if(running.isAvailable()||running.isStarting()){
                imageGenSessionMessage=running.isReady()
                        ? "이미 런처 내장 이미지 서버가 실행 중입니다. ComfyUI 주소를 바꾸려면 주소를 입력한 뒤 연결 버튼을 누르세요."
                        : (running.message.isEmpty() ? "이미지 서버 응답은 확인됐지만 공급자 설정이 아직 준비되지 않았습니다." : running.message);
                refreshImageGenStatus();
                Toast.makeText(this,imageGenSessionMessage,Toast.LENGTH_LONG).show();
                return;
            }
            if(imageGenCopying||manualImageGenPreparing){
                imageGenSessionMessage="내장 이미지 서버를 준비하고 있습니다. 준비가 끝난 뒤 다시 시도해 주세요.";
                refreshImageGenStatus();
                Toast.makeText(this,imageGenSessionMessage,Toast.LENGTH_LONG).show();
                return;
            }
            manualImageGenPreparing=true;
        }

        final File backend=imageGenBackendRoot();
        final String requestedUrl=comfyUrl==null?"":comfyUrl.trim();
        final String launcherProfileId="launcher".equals(mode)?activeProfileId:"";
        final String launcherProviderId;
        try{
            if("launcher".equals(mode)){
                if(launcherProfileId==null||!launcherProfileId.matches("[a-f0-9]{32}"))throw new IllegalStateException("현재 게임 프로필이 없습니다.");
                ImageProviderStore.Snapshot providers=new ImageProviderStore(this).load();
                launcherProviderId=providers.defaults.get(launcherProfileId);
                ImageProviderStore.Provider selected=ImageProviderStore.find(providers,launcherProviderId);
                if(selected==null||!selected.enabled||!selected.allowInGame)throw new IllegalStateException("기본 이미지 서비스가 없거나 게임 사용이 허용되지 않았습니다.");
            }else launcherProviderId="";
        }catch(Exception error){
            manualImageGenPreparing=false;
            imageGenSessionMessage="등록 이미지 서비스 확인 실패: "+msg(error);
            refreshImageGenStatus();
            Toast.makeText(this,imageGenSessionMessage,Toast.LENGTH_LONG).show();
            return;
        }
        imageGenSessionMessage=("novelai".equals(mode)?"NovelAI":"launcher".equals(mode)?"등록 이미지 서비스":"ComfyUI 연결")+" 런처 내장 서버를 준비하고 있습니다…";
        refreshImageGenStatus();
        new Thread(()->{
            String failure=null;
            try{
                ImageGenBackendInstaller.install(this,backend);
                // Server availability is independent of provider credentials.
                // NovelAI credentials are supplied only to the NovelAI runtime;
                // Cloudflare FLUX uses its own ImageProviderStore provider record.
                writeImageGenRuntimeConfig(backend,mode,requestedUrl,launcherProfileId,launcherProviderId);
            }catch(Throwable error){
                failure=error.getMessage()==null?error.getClass().getSimpleName():error.getMessage();
            }
            final String problem=failure;
            runOnUiThread(()->{
                if(problem!=null){
                    manualImageGenPreparing=false;
                    imageGenSessionMessage="내장 이미지 서버 준비 실패: "+problem;
                    try { ImageGenStatusStore.write(getFilesDir(),false,false,imageGenSessionMessage,""); }
                    catch (Exception ignored) {}
                    refreshImageGenStatus();
                    Toast.makeText(this,imageGenSessionMessage,Toast.LENGTH_LONG).show();
                    return;
                }
                String launchVersion="launcher-imagegen:"+ImageGenBackendInstaller.VERSION+":"+mode
                        +("launcher".equals(mode)?":"+launcherProfileId+":"+launcherProviderId:"");
                try {
                    ImageGenStatusStore.write(getFilesDir(),false,true,"런처 내장 ImageGen 서버 시작 중…",launchVersion);
                } catch (Exception error) {
                    manualImageGenPreparing=false;
                    imageGenSessionMessage="이미지 서버 상태를 저장하지 못했습니다: "+msg(error);
                    refreshImageGenStatus();
                    return;
                }
                imageGenReadyCallbacks.add(()->{
                    ImageGenStatusStore.State state=ImageGenStatusStore.read(getFilesDir());
                    if(!state.isReady())imageGenSessionMessage=state.message;
                    refreshImageGenStatus();
                });
                startImageGenService(backend,launchVersion,mode,requestedUrl,launcherProfileId,launcherProviderId);
                manualImageGenPreparing=false;
                refreshImageGenStatus();
                waitForImageGenReady();
            });
        },"wayward-imagegen-bundled-prepare").start();
    }

    private void writeImageGenRuntimeConfig(File backend,String mode,String comfyUrl,
                                             String launcherProfileId,String launcherProviderId)throws Exception{
        File project=new File(backend,"wayward-imagegen");
        if(!new File(project,"src/cli.ts").isFile())throw new IllegalStateException("내장 wayward-imagegen/src/cli.ts가 없습니다.");
        JSONObject config=new JSONObject();
        config.put("host","127.0.0.1");
        config.put("port",8189);
        config.put("imagesDir",new File(getFilesDir(),"imagegen/images").getAbsolutePath());
        config.put("stateDir",new File(getFilesDir(),"imagegen/state").getAbsolutePath());
        config.put("comfyUrl",comfyUrl==null||comfyUrl.isEmpty()?"http://127.0.0.1:8188":comfyUrl);
        config.put("imageProvider","launcher".equals(mode)?"launcher":"novelai".equals(mode)?"nai":"sdxl");
        config.put("launcherProviderUrl","launcher".equals(mode)?"http://127.0.0.1:8190/generate":"");
        config.put("launcherProfileId",launcherProfileId==null?"":launcherProfileId);
        config.put("launcherProviderId",launcherProviderId==null?"":launcherProviderId);
        config.put("launcherProviderSignature","launcher".equals(mode)?launcherProfileId+":"+launcherProviderId:"");
        config.put("launcherProviderToken","");
        config.put("naiModel","nai-diffusion-4-5-full");
        // Android has no bundled sharp binary; PNG is the supported no-dependency path.
        config.put("webp",false);
        config.put("requireWebp",false);
        File images=new File(getFilesDir(),"imagegen/images");
        File state=new File(getFilesDir(),"imagegen/state");
        if(!images.isDirectory()&&!images.mkdirs()&&!images.isDirectory())throw new IllegalStateException("이미지 저장 폴더를 만들지 못했습니다.");
        if(!state.isDirectory()&&!state.mkdirs()&&!state.isDirectory())throw new IllegalStateException("이미지 상태 폴더를 만들지 못했습니다.");
        synchronizeImageGenProviderSetting(state,mode);
        File output=new File(project,"wayward-imagegen.config.json");
        File temporary=new File(project,"wayward-imagegen.config.json.tmp");
        try(FileOutputStream stream=new FileOutputStream(temporary)){
            stream.write(config.toString().getBytes(StandardCharsets.UTF_8));
            stream.flush();
            stream.getFD().sync();
        }
        try{
            java.nio.file.Files.move(temporary.toPath(),output.toPath(),
                    java.nio.file.StandardCopyOption.REPLACE_EXISTING,
                    java.nio.file.StandardCopyOption.ATOMIC_MOVE);
        }catch(java.nio.file.AtomicMoveNotSupportedException error){
            java.nio.file.Files.move(temporary.toPath(),output.toPath(),
                    java.nio.file.StandardCopyOption.REPLACE_EXISTING);
        }
    }

    private void synchronizeImageGenProviderSetting(File stateDirectory,String mode)throws Exception{
        File settingsFile=new File(stateDirectory,"anima-settings.json");
        if(!settingsFile.isFile())return;
        if(settingsFile.length()<=0||settingsFile.length()>2*1024*1024)throw new IllegalStateException("기존 Image Studio 설정 파일 크기가 올바르지 않습니다.");
        byte[] bytes=java.nio.file.Files.readAllBytes(settingsFile.toPath());
        org.json.JSONObject settings=new org.json.JSONObject(new String(bytes,StandardCharsets.UTF_8));
        String provider="launcher".equals(mode)?"launcher":"novelai".equals(mode)?"nai":"sdxl";
        settings.put("imageProvider",provider);
        // Credentials are supplied by Android Keystore, never persisted here.
        settings.put("naiToken","");
        File temporary=new File(stateDirectory,"anima-settings.json.tmp");
        try(FileOutputStream output=new FileOutputStream(temporary,false)){
            output.write((settings.toString()+"\n").getBytes(StandardCharsets.UTF_8));
            output.flush();
            output.getFD().sync();
        }
        try{
            java.nio.file.Files.move(temporary.toPath(),settingsFile.toPath(),
                    java.nio.file.StandardCopyOption.ATOMIC_MOVE,
                    java.nio.file.StandardCopyOption.REPLACE_EXISTING);
        }catch(java.nio.file.AtomicMoveNotSupportedException error){
            java.nio.file.Files.move(temporary.toPath(),settingsFile.toPath(),
                    java.nio.file.StandardCopyOption.REPLACE_EXISTING);
        }finally{
            if(temporary.exists())temporary.delete();
        }
    }

    private void startImageGenService(File backend, String version) {
        startImageGenService(backend,version,"default","");
    }

    private void startImageGenService(File backend,String version,String launchMode,String comfyUrl){
        startImageGenService(backend,version,launchMode,comfyUrl,"","");
    }

    private void startImageGenService(File backend,String version,String launchMode,String comfyUrl,
                                      String launcherProfileId,String launcherProviderId){
        Intent intent = new Intent(this, ImageGenService.class);
        intent.setAction(ImageGenService.ACTION_START);
        intent.putExtra(ImageGenService.EXTRA_BACKEND_ROOT, backend.getAbsolutePath());
        intent.putExtra(ImageGenService.EXTRA_BACKEND_VERSION, version);
        intent.putExtra(ImageGenService.EXTRA_LAUNCH_MODE, launchMode);
        intent.putExtra(ImageGenService.EXTRA_COMFY_URL, comfyUrl==null?"":comfyUrl);
        intent.putExtra(ImageGenService.EXTRA_LAUNCHER_PROFILE_ID, launcherProfileId==null?"":launcherProfileId);
        intent.putExtra(ImageGenService.EXTRA_LAUNCHER_PROVIDER_ID, launcherProviderId==null?"":launcherProviderId);
        try {
            if (android.os.Build.VERSION.SDK_INT >= 26) startForegroundService(intent);
            else startService(intent);
            imageGenSessionMessage = "Wayward ImageGen " + version + " 서버 시작 요청을 전달했습니다.";
            refreshImageGenStatus();
        } catch (Throwable error) {
            DiagnosticsLogger.error(this,"imagegen","service_start_request_failed",error);
            String message = error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage();
            imageGenSessionMessage = "이미지 서버 시작 요청 실패: " + message;
            try {
                ImageGenStatusStore.write(getFilesDir(), false, false, imageGenSessionMessage, version);
            } catch (Exception ignored) {}
            refreshImageGenStatus();
            finishImageGenCallbacks();
        }
    }

    private void stopImageGenServer() {
        DiagnosticsLogger.event(this,"INFO","imagegen","stop_requested",null);
        Intent intent = new Intent(this, ImageGenService.class).setAction(ImageGenService.ACTION_STOP);
        try {
            startService(intent);
        } catch (Exception ignored) {
            stopService(new Intent(this, ImageGenService.class));
        }
        imageGenSessionMessage = "이미지 생성 서버 중지 요청을 보냈습니다.";
        if (imageGenStatus != null) imageGenStatus.setText(imageGenSessionMessage);
    }

    private void refreshImageGenStatus() {
        if (imageGenStatus == null) return;
        ImageGenStatusStore.State state = ImageGenStatusStore.read(getFilesDir());
        if (state.isReady()) {
            boolean comfy = state.backendVersion != null && state.backendVersion.endsWith(":comfy");
            String endpoint = getSharedPreferences(PREFS, MODE_PRIVATE).getString(KEY_COMFY_URL, "");
            if (comfy && (endpoint == null || endpoint.trim().isEmpty())) {
                imageGenStatus.setText("로컬 ComfyUI 중계 서버 실행됨 · PC 주소 미설정 · 연결 대기 중 · 127.0.0.1:8189");
            } else {
                imageGenStatus.setText("런처 내장 ImageGen " + ImageGenBackendInstaller.VERSION + " 실행 중 · 127.0.0.1:8189");
            }
        }
        else if (state.isAvailable()) imageGenStatus.setText(state.message.isEmpty()
                ? "이미지 서버 응답 확인됨 · 공급자 설정을 확인해 주세요." : state.message);
        else if (state.isStarting()) imageGenStatus.setText(state.message.isEmpty() ? "이미지 생성 서버 시작 중…" : state.message);
        else if (imageGenCopying || manualImageGenPreparing) imageGenStatus.setText("이미지 생성 백엔드 준비 중…");
        else if (state.ready && !state.isFresh()) imageGenStatus.setText("이미지 생성 서비스 heartbeat가 끊겼습니다. 현재 세션을 다시 열면 서버를 재시작합니다.");
        else if (!state.message.isEmpty()) imageGenStatus.setText(state.message);
        else if (imageGenSessionMessage != null && !imageGenSessionMessage.isEmpty()) imageGenStatus.setText(imageGenSessionMessage);
        else imageGenStatus.setText("서버가 실행되지 않았습니다.");
    }

    private static void deleteFileTree(File file) {
        if (file == null || !file.exists()) return;
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children != null) for (File child : children) deleteFileTree(child);
        }
        file.delete();
    }

    private void showHomePanel(){runOnUiThread(()->{if(web!=null)web.setVisibility(View.GONE);if(home!=null)home.setVisibility(View.VISIBLE);refreshStatus();});}
    private void destroyWeb(){if(webFileChooser!=null){webFileChooser.cancelPending();webFileChooser=null;}if(web==null)return;web.removeJavascriptInterface("WMLHost");root.removeView(web);web.stopLoading();web.loadUrl("about:blank");web.destroy();web=null;}
    @Override public void onBackPressed(){if(web!=null&&web.getVisibility()==View.VISIBLE){if(web.canGoBack())web.goBack();else showHomePanel();return;}super.onBackPressed();}
    @Override protected void onDestroy(){
        String sessionId=sessionProfileId(getIntent());if(sessionId!=null)RUNNING_SESSIONS.remove(sessionId);
        unregisterSessionActivity();
        DiagnosticsLogger.event(this,"INFO","launcher","activity_destroy",null);
        destroyWeb();if(zipMods!=null)zipMods.close();super.onDestroy();
    }
    private String msg(Throwable e){return e==null||e.getMessage()==null?"알 수 없는 오류":e.getMessage();}
    private final class HostBridge{
        @JavascriptInterface public String version(){return "0.3.2";}
        @JavascriptInterface public void imageGenProxyFetch(String requestId,String method,String path,String headersJson,String bodyBase64){
            ImageGenProxy.dispatch(web,requestId,method,path,headersJson,bodyBase64);
        }
        @JavascriptInterface public String listImageProviders(){
            return ImageProviderBridge.list(MainActivity.this,activeProfileId);
        }
        @JavascriptInterface public void generateImageWithProvider(String requestId,String providerId,String prompt,int width,int height){
            ImageProviderBridge.generate(MainActivity.this,web,activeProfileId,requestId,providerId,prompt,width,height);
        }
        @JavascriptInterface public String imageGenRuntimeStatus(){
            ImageGenStatusStore.State state=ImageGenStatusStore.read(getFilesDir());
            try{
                JSONObject result=new JSONObject();
                result.put("available",state.isAvailable());
                result.put("ready",state.isReady());
                result.put("starting",state.isStarting());
                result.put("backendVersion",state.backendVersion);
                return result.toString();
            }catch(Exception ignored){return "{\"available\":false,\"ready\":false,\"starting\":false}";}
        }
        @JavascriptInterface public void logImageProviderDiagnostic(String eventName,String detailsJson){
            if(eventName==null||!eventName.matches("[a-z0-9_]{1,64}"))return;
            ImagePipelineDiagnostics.recordJson(MainActivity.this,eventName,detailsJson);
        }
        @JavascriptInterface public String listModIds(){
            try{JSONObject r=new JSONObject();JSONArray a=new JSONArray();for(String id:allModIds())a.put(id);r.put("ok",true);r.put("ids",a);return r.toString();}
            catch(Exception e){try{JSONObject r=new JSONObject();r.put("ok",false);r.put("ids",new JSONArray());return r.toString();}catch(Exception ignored){return "{}";}}
        }
        @JavascriptInterface public void menu(){showHomePanel();}
        @JavascriptInterface public String takePendingState(){return "";}
        @JavascriptInterface public String saveFile(String name,String mime,String encoded){try{saveExport(name,mime,encoded);return null;}catch(Exception e){return msg(e);}}
    }
    private void saveExport(String req,String mime,String encoded)throws Exception{
        String name=req==null?"wayward-export.bin":req.replace("/","_").replace("\\\\","_").trim();if(name.isEmpty()||name.equals(".")||name.equals(".."))name="wayward-export.bin";
        if(encoded==null||encoded.length()>140*1024*1024)throw new IllegalArgumentException("파일이 너무 큽니다.");
        byte[] bytes=android.util.Base64.decode(encoded,android.util.Base64.DEFAULT);ContentValues v=new ContentValues();v.put(MediaStore.Downloads.DISPLAY_NAME,name);v.put(MediaStore.Downloads.MIME_TYPE,mime==null?"application/octet-stream":mime);v.put(MediaStore.Downloads.RELATIVE_PATH,Environment.DIRECTORY_DOWNLOADS+"/Wayward");v.put(MediaStore.Downloads.IS_PENDING,1);
        Uri item=getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI,v);if(item==null)throw new IllegalStateException("Download/Wayward 저장 실패");
        boolean ok=false;try(OutputStream out=getContentResolver().openOutputStream(item,"w")){if(out==null)throw new IllegalStateException("파일 열기 실패");out.write(bytes);out.flush();ContentValues d=new ContentValues();d.put(MediaStore.Downloads.IS_PENDING,0);getContentResolver().update(item,d,null,null);ok=true;}finally{if(!ok)getContentResolver().delete(item,null,null);}
    }
    private static final class FolderHandler implements WebViewAssetLoader.PathHandler{
        private static final String CORE="wml/runtime/wml-core.js";private static final String BUNDLED_SYMBOL_TABLE="wml/symbols/2026-11-01.js";private final SafTree tree;private final android.content.res.AssetManager assets;private final ZipModStore zipMods;private final String origin;
        FolderHandler(SafTree t,android.content.res.AssetManager a,ZipModStore z,String o){tree=t;assets=a;zipMods=z;origin=o;}
        @Override public WebResourceResponse handle(String p){return serveGamePath(p);}
        static boolean isGameRequestPath(String path){
            return path!=null&&path.startsWith("/game/");
        }
        WebResourceResponse serveGamePath(String relative){
            WebResourceResponse result=serve(relative);
            return result!=null?result:response(404,"Not Found","text/plain","Game resource not found");
        }
        static boolean isImageRequestPath(String path){
            return path!=null&&path.regionMatches(true,0,"/images/",0,8);
        }
        static boolean isLocalOnlyCharacterImagePath(String path){
            String prefix="/images/illustrious/characters/";
            return path!=null&&path.regionMatches(true,0,prefix,0,prefix.length());
        }
        static boolean isImageAssetPath(String path){
            return path!=null&&path.regionMatches(true,0,"images/",0,7);
        }
        WebResourceResponse serveImagePath(String relative){
            WebResourceResponse result=serveLocalImage(relative);
            return result!=null?result:response(404,"Not Found","text/plain","Local image not found");
        }
        WebResourceResponse serveExternalImagePath(String relative){
            return serveLocalImage(relative);
        }
        private WebResourceResponse serveLocalImage(String relative){
            String path=normal(relative);
            if(path==null)return response(400,"Bad Request","text/plain","Invalid local image path");
            String filePath="images/"+path;
            try{
                InputStream in=tree==null?null:tree.openImage(filePath);
                if(in==null&&zipMods!=null)in=zipMods.open(filePath);
                if(in==null)return null;
                String m=mime(filePath);
                return new WebResourceResponse(m,text(m)?"UTF-8":null,200,"OK",headers(filePath),in);
            }catch(Exception e){
                return response(500,"Read Error","text/plain","Image read error: "+e.getMessage());
            }
        }
        WebResourceResponse serve(String raw){
            try{
                String p=normal(raw);
                if(p==null)return response(404,"Not Found","text/plain","Not found");
                if(tree==null&&!BUNDLED_SYMBOL_TABLE.equals(p))
                    return response(404,"Not Found","text/plain","Not found");
                InputStream in=tree==null?null:(isImageAssetPath(p)?tree.openImage(p):tree.open(p));
                if(in==null&&zipMods!=null)in=zipMods.open(p);
                if(in==null&&BUNDLED_SYMBOL_TABLE.equals(p))in=assets.open(BUNDLED_SYMBOL_TABLE);
                if(in==null)return null;
                if(p.toLowerCase(Locale.ROOT).endsWith(".html")||p.toLowerCase(Locale.ROOT).endsWith(".htm"))in=mobileViewport(in);
                if(CORE.equals(p))in=new SequenceInputStream(assets.open("wml-folder-bootstrap.js"),in);
                String m=mime(p);
                return new WebResourceResponse(m,text(m)?"UTF-8":null,200,"OK",headers(p),in);
            }catch(Exception e){return response(500,"Read Error","text/plain","Read error: "+e.getMessage());}
        }
        static InputStream mobileViewport(InputStream source)throws Exception{
            ByteArrayOutputStream prefix=new ByteArrayOutputStream();
            byte[] chunk=new byte[4096];int total=0,n,closeEnd=-1;
            while(total<128*1024){
                n=source.read(chunk,0,Math.min(chunk.length,128*1024-total));
                if(n<0)break;
                if(n==0)continue;
                prefix.write(chunk,0,n);total+=n;
                byte[] probe=prefix.toByteArray();
                closeEnd=indexOfIgnoreCase(probe,"</head>",0,probe.length);
                if(closeEnd>=0){closeEnd+=7;break;}
            }
            byte[] original=prefix.toByteArray();
            if(closeEnd<0)return new SequenceInputStream(new ByteArrayInputStream(original),source);
            int headStart=indexOfIgnoreCase(original,"<head",0,closeEnd);
            if(headStart<0)return new SequenceInputStream(new ByteArrayInputStream(original),source);
            int headTagEnd=indexOfByte(original,(byte)'>',headStart,closeEnd);
            if(headTagEnd<0)return new SequenceInputStream(new ByteArrayInputStream(original),source);
            int closeStart=closeEnd-7;
            String head=new String(original,headStart,closeStart-headStart,StandardCharsets.ISO_8859_1);
            Matcher viewport=Pattern.compile("(?is)<meta\\b[^>]*\\bname\\s*=\\s*(['\"]?)viewport\\1[^>]*>").matcher(head);
            byte[] meta="<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0, viewport-fit=cover\">".getBytes(StandardCharsets.US_ASCII);
            int replaceStart,replaceEnd;
            if(viewport.find()){replaceStart=headStart+viewport.start();replaceEnd=headStart+viewport.end();}
            else{replaceStart=headTagEnd+1;replaceEnd=replaceStart;}
            String lowerHead=head.toLowerCase(Locale.ROOT);
            byte[] imageServerHints=(lowerHead.contains("art.sintention.com")&&lowerHead.contains("preconnect"))
                    ?new byte[0]
                    :"<link rel=\"dns-prefetch\" href=\"//art.sintention.com\"><link rel=\"preconnect\" href=\"https://art.sintention.com\" crossorigin>".getBytes(StandardCharsets.US_ASCII);
            ByteArrayOutputStream patched=new ByteArrayOutputStream(original.length+meta.length+imageServerHints.length+16);
            patched.write(original,0,replaceStart);
            patched.write(imageServerHints);
            patched.write(meta);
            patched.write(original,replaceEnd,original.length-replaceEnd);
            return new SequenceInputStream(new ByteArrayInputStream(patched.toByteArray()),source);
        }
        static int indexOfIgnoreCase(byte[] data,String needle,int from,int limit){
            byte[] p=needle.toLowerCase(Locale.ROOT).getBytes(StandardCharsets.US_ASCII);
            for(int i=from;i<=limit-p.length;i++){
                boolean match=true;
                for(int j=0;j<p.length;j++){
                    int ch=data[i+j]&0xff;if(ch>='A'&&ch<='Z')ch+=32;
                    if(ch!=(p[j]&0xff)){match=false;break;}
                }
                if(match)return i;
            }
            return -1;
        }
        static int indexOfByte(byte[] data,byte target,int from,int limit){
            for(int i=from;i<limit;i++)if(data[i]==target)return i;
            return -1;
        }
        static String normal(String raw){if(raw==null||raw.isEmpty())return null;List<String> p=Uri.parse("https://x.invalid/"+raw).getPathSegments();if(p.isEmpty())return null;for(String s:p)if(s==null||s.isEmpty()||s.equals(".")||s.equals("..")||s.indexOf('\\')>=0||s.indexOf('\0')>=0)return null;return String.join("/",p);}
        java.util.Map<String,String> headers(String path){
            java.util.Map<String,String> h=new java.util.HashMap<>();
            if(cacheableMedia(path))h.put("Cache-Control","private, max-age=86400");
            else{h.put("Cache-Control","no-store, no-cache, must-revalidate");h.put("Pragma","no-cache");}
            h.put("Access-Control-Allow-Origin",origin);h.put("X-Content-Type-Options","nosniff");return h;
        }
        static boolean cacheableMedia(String path){
            if(path==null)return false;String p=path.toLowerCase(Locale.ROOT);
            return p.endsWith(".png")||p.endsWith(".jpg")||p.endsWith(".jpeg")||p.endsWith(".webp")||p.endsWith(".gif")||p.endsWith(".avif")||p.endsWith(".svg")||p.endsWith(".woff")||p.endsWith(".woff2")||p.endsWith(".ttf")||p.endsWith(".otf");
        }
        WebResourceResponse response(int c,String r,String m,String s){return new WebResourceResponse(m,"UTF-8",c,r,headers(null),new ByteArrayInputStream(s.getBytes(StandardCharsets.UTF_8)));}
        static boolean text(String m){return m.startsWith("text/")||m.contains("javascript")||m.contains("json")||m.contains("xml")||m.contains("svg");}
        static String mime(String p){p=p.toLowerCase(Locale.ROOT);if(p.endsWith(".html"))return"text/html";if(p.endsWith(".js")||p.endsWith(".mjs"))return"application/javascript";if(p.endsWith(".css"))return"text/css";if(p.endsWith(".json"))return"application/json";if(p.endsWith(".svg"))return"image/svg+xml";if(p.endsWith(".png"))return"image/png";if(p.endsWith(".jpg")||p.endsWith(".jpeg"))return"image/jpeg";if(p.endsWith(".webp"))return"image/webp";if(p.endsWith(".gif"))return"image/gif";if(p.endsWith(".avif"))return"image/avif";if(p.endsWith(".woff2"))return"font/woff2";if(p.endsWith(".ttf"))return"font/ttf";if(p.endsWith(".wasm"))return"application/wasm";if(p.endsWith(".mp4"))return"video/mp4";if(p.endsWith(".webm"))return"video/webm";if(p.endsWith(".mp3"))return"audio/mpeg";if(p.endsWith(".ogg"))return"audio/ogg";if(p.endsWith(".wav"))return"audio/wav";if(p.endsWith(".txt"))return"text/plain";return"application/octet-stream";}
    }
    private final class SafTree{
        private static final int MAX_CACHED_DIRECTORIES=2048;
        private static final int MAX_CACHED_CHILDREN=100000;
        private final Uri tree;private final String rootId;
        private final SafImageCache imageCache = new SafImageCache(MainActivity.this);
        private final java.util.concurrent.atomic.AtomicInteger imageTimingSamples = new java.util.concurrent.atomic.AtomicInteger();
        private static final int MAX_CONCURRENT_DIRECTORY_QUERIES = 4;
        private final Object directoryIndexLock=new Object();
        private final java.util.LinkedHashMap<String,java.util.Map<String,Node>> directoryIndexCache =
                new java.util.LinkedHashMap<>(16, 0.75f, true);
        private final java.util.Map<String,java.util.Map<String,Node>> caseInsensitiveDirectoryCache = new java.util.HashMap<>();
        private final java.util.concurrent.ConcurrentHashMap<String,java.util.concurrent.FutureTask<java.util.Map<String,Node>>> directoryLoads =
                new java.util.concurrent.ConcurrentHashMap<>();
        private final java.util.concurrent.Semaphore directoryQuerySlots =
                new java.util.concurrent.Semaphore(MAX_CONCURRENT_DIRECTORY_QUERIES, true);
        private final java.util.concurrent.atomic.AtomicLong directoryIndexGeneration =
                new java.util.concurrent.atomic.AtomicLong();
        private final Object modIdsLock = new Object();
        private volatile List<String> cachedModIds;
        private volatile long cachedModIdsGeneration = -1L;
        private int cachedDirectoryChildren=0;
        SafTree(Uri u){tree=u;rootId=DocumentsContract.getTreeDocumentId(u);}
        String rootName(){try{return node(rootId).name;}catch(Exception e){return"Wayward";}}
        List<String> rootHtmlFiles()throws Exception{
            List<String> names=new ArrayList<>();
            for(Node n:children(rootId))if(!n.dir){
                String lower=n.name.toLowerCase(Locale.ROOT);
                if(lower.endsWith(".html")||lower.endsWith(".htm"))names.add(n.name);
            }
            return names;
        }
        boolean exists(String p){try{Node n=resolve(p);return n!=null&&!n.dir;}catch(Exception e){return false;}}
        InputStream open(String p)throws Exception{Node n=resolve(p);if(n==null||n.dir)return null;return getContentResolver().openInputStream(DocumentsContract.buildDocumentUriUsingTree(tree,n.id));}
        InputStream openImage(String p)throws Exception{
            long resolveStarted=System.nanoTime();
            Node n=resolveImage(p);
            long resolveMs=(System.nanoTime()-resolveStarted)/1_000_000L;
            if(n==null||n.dir){
                recordImageOpenTiming(p,resolveMs,0L,null,-1L);
                return null;
            }
            long accessStarted=System.nanoTime();
            Uri documentUri=DocumentsContract.buildDocumentUriUsingTree(tree,n.id);
            SafImageCache.OpenResult opened=imageCache.open(getContentResolver(),documentUri,n.id,n.size,n.lastModified);
            long accessMs=(System.nanoTime()-accessStarted)/1_000_000L;
            recordImageOpenTiming(p,resolveMs,accessMs,opened,n.size);
            return opened==null?null:opened.stream;
        }
        private Node resolveImage(String path)throws Exception{
            String p=FolderHandler.normal(path);if(p==null)return null;
            String parent=rootId;Node n=null;String[] parts=p.split("/");
            for(int i=0;i<parts.length;i++){
                n=findIgnoreCase(parent,parts[i]);if(n==null)return null;
                if(i<parts.length-1){if(!n.dir)return null;parent=n.id;}
            }
            return n;
        }
        private void recordImageOpenTiming(String path,long resolveMs,long accessMs,SafImageCache.OpenResult opened,long imageSize){
            int sample=imageTimingSamples.getAndIncrement();
            if(sample>=96&&resolveMs<350L&&accessMs<350L)return;
            JSONObject details=new JSONObject();
            try{
                details.put("elapsedMs",resolveMs+accessMs);
                details.put("resolveImageMs",resolveMs);
                details.put("imageAccessMs",accessMs);
                if(opened!=null){
                    details.put("cacheState",opened.cacheState);
                    details.put("openInputStreamMs",opened.openInputStreamMs);
                    details.put("cacheWaitMs",opened.cacheWaitMs);
                    details.put("cacheOpenMs",opened.cacheOpenMs);
                }else{
                    details.put("cacheState","missing");
                }
                if(imageSize>=0L)details.put("imageSizeBytes",imageSize);
                ImagePipelineDiagnostics.addSanitizedPath(details,"/"+path);
            }catch(Exception ignored){}
            ImagePipelineDiagnostics.record(MainActivity.this,"saf_image_open_timing",details);
        }
        private void recordDirectoryQueryTiming(long waitMs,long queryMs,int childCount){
            if(waitMs<250L&&queryMs<250L)return;
            JSONObject details=new JSONObject();
            try{
                details.put("elapsedMs",waitMs+queryMs);
                details.put("directoryWaitMs",waitMs);
                details.put("directoryQueryMs",queryMs);
                details.put("directoryChildCount",childCount);
            }catch(Exception ignored){}
            ImagePipelineDiagnostics.record(MainActivity.this,"saf_directory_query_timing",details);
        }

        String imageStudioModId() throws Exception {
            // The game folder supplies only the WML adapter marker.
            // The actual server is always installed from the launcher APK.
            Node modDirectory = resolve("wml/mods/imagestudio");
            if (modDirectory == null || !modDirectory.dir) return null;
            Node modScript = find(modDirectory.id, "mod.js");
            if (modScript == null || modScript.dir || !"imagestudio".equals(declared(modScript))) return null;
            return "imagestudio";
        }

        List<String> listModIds()throws Exception{
            long generation=directoryIndexGeneration.get();
            List<String> cached=cachedModIds;
            if(cached!=null&&cachedModIdsGeneration==generation)return new ArrayList<>(cached);
            synchronized(modIdsLock){
                generation=directoryIndexGeneration.get();
                cached=cachedModIds;
                if(cached!=null&&cachedModIdsGeneration==generation)return new ArrayList<>(cached);
                List<String> ids=new ArrayList<>();
                Node mods=resolve("wml/mods");
                if(mods!=null&&mods.dir){
                    for(Node d:children(mods.id)){
                        if(!d.dir||!ID.matcher(d.name).matches())continue;
                        Node f=find(d.id,"mod.js");
                        if(f==null||f.dir)continue;
                        String id=declared(f);
                        if(id!=null&&(id.isEmpty()||id.equals(d.name)))ids.add(d.name);
                    }
                }
                Collections.sort(ids);
                if(directoryIndexGeneration.get()==generation){
                    cachedModIds=Collections.unmodifiableList(new ArrayList<>(ids));
                    cachedModIdsGeneration=generation;
                }
                return ids;
            }
        }
        String declared(Node f){
            try{Uri u=DocumentsContract.buildDocumentUriUsingTree(tree,f.id);byte[] b=new byte[65536];int used=0;try(InputStream in=getContentResolver().openInputStream(u)){if(in==null)return null;while(used<b.length){int n=in.read(b,used,b.length-used);if(n<0)break;used+=n;}}
                String s=new String(b,0,used,StandardCharsets.UTF_8);int at=s.indexOf("WML.define");if(at<0)return null;Matcher m=MOD_ID.matcher(s.substring(at));return m.find()?m.group(1):"";
            }catch(Exception e){return null;}
        }
        Node resolve(String path)throws Exception{String p=FolderHandler.normal(path);if(p==null)return null;String parent=rootId;Node n=null;String[] parts=p.split("/");for(int i=0;i<parts.length;i++){n=find(parent,parts[i]);if(n==null)return null;if(i<parts.length-1){if(!n.dir)return null;parent=n.id;}}return n;}
        Node find(String parent,String name)throws Exception{return childIndex(parent).get(name);}
        private Node findIgnoreCase(String parent,String name)throws Exception{
            long generation=directoryIndexGeneration.get();
            java.util.Map<String,Node> index=childIndex(parent);
            Node exact=index.get(name);if(exact!=null)return exact;
            String key=name.toLowerCase(Locale.ROOT);
            synchronized(directoryIndexLock){
                java.util.Map<String,Node> folded=caseInsensitiveDirectoryCache.get(parent);
                if(folded==null){
                    java.util.Map<String,Node> built=new java.util.HashMap<>();
                    Set<String> ambiguous=new HashSet<>();
                    for(Node candidate:index.values()){
                        String candidateKey=candidate.name.toLowerCase(Locale.ROOT);
                        if(ambiguous.contains(candidateKey))continue;
                        Node previous=built.put(candidateKey,candidate);
                        if(previous!=null){
                            built.remove(candidateKey);
                            ambiguous.add(candidateKey);
                        }
                    }
                    folded=built;
                    if(directoryIndexGeneration.get()==generation&&directoryIndexCache.containsKey(parent)){
                        caseInsensitiveDirectoryCache.put(parent,folded);
                    }
                }
                return folded.get(key);
            }
        }
        List<Node> children(String parent)throws Exception{return new ArrayList<>(childIndex(parent).values());}
        java.util.Map<String,Node> childIndex(String parent)throws Exception{
            long generation;
            synchronized(directoryIndexLock){
                java.util.Map<String,Node> cached=directoryIndexCache.get(parent);
                if(cached!=null)return cached;
                generation=directoryIndexGeneration.get();
            }
            java.util.concurrent.FutureTask<java.util.Map<String,Node>> task =
                    new java.util.concurrent.FutureTask<>(() -> loadDirectoryIndex(parent,generation));
            java.util.concurrent.FutureTask<java.util.Map<String,Node>> active=directoryLoads.putIfAbsent(parent,task);
            if(active==null){active=task;task.run();}
            try{
                return active.get();
            }catch(InterruptedException error){
                Thread.currentThread().interrupt();
                throw error;
            }catch(java.util.concurrent.ExecutionException error){
                Throwable cause=error.getCause();
                if(cause instanceof Exception)throw (Exception)cause;
                if(cause instanceof Error)throw (Error)cause;
                throw new IllegalStateException("SAF 디렉터리 조회 실패",cause);
            }finally{
                directoryLoads.remove(parent,active);
            }
        }
        private java.util.Map<String,Node> loadDirectoryIndex(String parent,long generation)throws Exception{
            java.util.Map<String,Node> loaded=new java.util.LinkedHashMap<>();
            long waitStarted=System.nanoTime();
            long waitMs=0L;
            long queryMs=0L;
            boolean acquired=false;
            try{
                directoryQuerySlots.acquire();
                acquired=true;
                waitMs=(System.nanoTime()-waitStarted)/1_000_000L;
                long queryStarted=System.nanoTime();
                try{
                    Uri u=DocumentsContract.buildChildDocumentsUriUsingTree(tree,parent);
                    try(Cursor c=getContentResolver().query(u,new String[]{
                            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                            DocumentsContract.Document.COLUMN_MIME_TYPE,
                            DocumentsContract.Document.COLUMN_SIZE,
                            DocumentsContract.Document.COLUMN_LAST_MODIFIED
                    },null,null,null)){
                        if(c!=null){
                            int idIndex=c.getColumnIndex(DocumentsContract.Document.COLUMN_DOCUMENT_ID);
                            int nameIndex=c.getColumnIndex(DocumentsContract.Document.COLUMN_DISPLAY_NAME);
                            int mimeIndex=c.getColumnIndex(DocumentsContract.Document.COLUMN_MIME_TYPE);
                            int sizeIndex=c.getColumnIndex(DocumentsContract.Document.COLUMN_SIZE);
                            int modifiedIndex=c.getColumnIndex(DocumentsContract.Document.COLUMN_LAST_MODIFIED);
                            while(c.moveToNext()){
                                String name=nameIndex>=0?c.getString(nameIndex):null;
                                if(name==null||name.isEmpty())continue;
                                String id=idIndex>=0?c.getString(idIndex):null;
                                String mime=mimeIndex>=0?c.getString(mimeIndex):null;
                                long size=sizeIndex>=0&&!c.isNull(sizeIndex)?c.getLong(sizeIndex):-1L;
                                long modified=modifiedIndex>=0&&!c.isNull(modifiedIndex)?c.getLong(modifiedIndex):-1L;
                                loaded.put(name,new Node(id,name,DocumentsContract.Document.MIME_TYPE_DIR.equals(mime),size,modified));
                            }
                        }
                    }
                }finally{
                    queryMs=(System.nanoTime()-queryStarted)/1_000_000L;
                }
            }finally{
                if(acquired)directoryQuerySlots.release();
            }
            recordDirectoryQueryTiming(waitMs,queryMs,loaded.size());
            synchronized(directoryIndexLock){
                if(directoryIndexGeneration.get()!=generation)return loaded;
                java.util.Map<String,Node> existing=directoryIndexCache.get(parent);
                if(existing!=null)return existing;
                if(loaded.size()<=MAX_CACHED_CHILDREN){
                    while(directoryIndexCache.size()>=MAX_CACHED_DIRECTORIES
                            ||cachedDirectoryChildren+loaded.size()>MAX_CACHED_CHILDREN){
                        java.util.Iterator<java.util.Map.Entry<String,java.util.Map<String,Node>>> iterator=directoryIndexCache.entrySet().iterator();
                        if(!iterator.hasNext())break;
                        java.util.Map.Entry<String,java.util.Map<String,Node>> eldest=iterator.next();
                        iterator.remove();
                        caseInsensitiveDirectoryCache.remove(eldest.getKey());
                        cachedDirectoryChildren-=eldest.getValue().size();
                    }
                    directoryIndexCache.put(parent,loaded);
                    cachedDirectoryChildren+=loaded.size();
                }
            }
            return loaded;
        }
        void invalidateDirectoryIndex(){
            synchronized(directoryIndexLock){
                directoryIndexGeneration.incrementAndGet();
                directoryIndexCache.clear();
                caseInsensitiveDirectoryCache.clear();
                cachedDirectoryChildren=0;
            }
            directoryLoads.clear();
            cachedModIds=null;
            cachedModIdsGeneration=-1L;
        }
        Node node(String id)throws Exception{
            Uri u=DocumentsContract.buildDocumentUriUsingTree(tree,id);
            try(Cursor c=getContentResolver().query(u,new String[]{
                    DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                    DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                    DocumentsContract.Document.COLUMN_MIME_TYPE,
                    DocumentsContract.Document.COLUMN_SIZE,
                    DocumentsContract.Document.COLUMN_LAST_MODIFIED
            },null,null,null)){
                if(c==null||!c.moveToFirst())return new Node(id,"Wayward",true,-1L,-1L);
                int idIndex=c.getColumnIndex(DocumentsContract.Document.COLUMN_DOCUMENT_ID);
                int nameIndex=c.getColumnIndex(DocumentsContract.Document.COLUMN_DISPLAY_NAME);
                int mimeIndex=c.getColumnIndex(DocumentsContract.Document.COLUMN_MIME_TYPE);
                int sizeIndex=c.getColumnIndex(DocumentsContract.Document.COLUMN_SIZE);
                int modifiedIndex=c.getColumnIndex(DocumentsContract.Document.COLUMN_LAST_MODIFIED);
                String nodeId=idIndex>=0?c.getString(idIndex):id;
                String name=nameIndex>=0?c.getString(nameIndex):"Wayward";
                String mime=mimeIndex>=0?c.getString(mimeIndex):null;
                long size=sizeIndex>=0&&!c.isNull(sizeIndex)?c.getLong(sizeIndex):-1L;
                long modified=modifiedIndex>=0&&!c.isNull(modifiedIndex)?c.getLong(modifiedIndex):-1L;
                return new Node(nodeId,name,DocumentsContract.Document.MIME_TYPE_DIR.equals(mime),size,modified);
            }
        }
    }
    private static final class Node{
        final String id,name;
        final boolean dir;
        final long size,lastModified;
        Node(String i,String n,boolean d){this(i,n,d,-1L,-1L);}
        Node(String i,String n,boolean d,long s,long m){id=i;name=n;dir=d;size=s;lastModified=m;}
    }
}
