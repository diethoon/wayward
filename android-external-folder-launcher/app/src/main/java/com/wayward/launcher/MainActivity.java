package com.wayward.launcher;

import android.app.Activity;
import android.content.ClipData;
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
import android.provider.OpenableColumns;
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
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
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
    private static final int PICK_TREE=4101, PICK_MOD_ZIP=4102;
    private static final String PREFS="wayward_launcher";
    private static final String KEY_TREE="game_tree_uri", KEY_PROFILES="game_profiles", KEY_ZIP_REV="zip_mod_revision", KEY_COMFY_URL="comfy_server_url";
    private static final String KO="Wayward_WML_ko.html", EN="Wayward_WML.html";
    private static final String BUILTIN_COMPANIONS_MOD_ID = "launcher-mobile-companions";
    private static final String BUILTIN_COMPANIONS_MOD_FILE = "wml/mods/" + BUILTIN_COMPANIONS_MOD_ID + "/mod.js";
    private static final Pattern ID=Pattern.compile("^[a-z0-9][a-z0-9._-]*$");
    private static final Set<String> RUNNING_SESSIONS=Collections.synchronizedSet(new HashSet<>());
    private static final Pattern MOD_ID=Pattern.compile("(?:\\bid\\s*:\\s*|[\\\"']id[\\\"']\\s*:\\s*)[\\\"']([a-z0-9][a-z0-9._-]*)[\\\"']");
    private Uri treeUri;
    private SafTree tree;
    private ZipModStore zipMods;
    private final List<GameProfile> profiles=new ArrayList<>();
    private String activeProfileId="";
    private long loadedZipRevision=-1;
    private FrameLayout root;
    private LinearLayout home, profileList, zipModList;
    private TextView status, folderText, profileSummary, zipSummary, imageGenStatus;
    private EditText comfyUrlInput;
    private String imageGenSessionMessage = "";
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
        if(home!=null&&home.getVisibility()==View.VISIBLE){renderProfiles();renderZipMods();refreshStatus();refreshImageGenStatus();}
    }
    @Override protected void onNewIntent(Intent intent){
        super.onNewIntent(intent);setIntent(intent);
        String sessionId=sessionProfileId(intent);
        if(sessionId==null)return;
        if(sessionId.equals(activeProfileId)&&web!=null){
            if(home!=null)home.setVisibility(View.GONE);
            web.setVisibility(View.VISIBLE);
        }else openProfileSession(sessionId);
    }
    private static final class GameProfile{
        final String id,uri,label;
        GameProfile(String i,String u,String n){id=i;uri=u;label=n;}
    }
    private int dp(float n){return Math.round(n*getResources().getDisplayMetrics().density);}
    private void status(String s){if(status!=null)status.setText(s);}
    private LinearLayout.LayoutParams buttonParams(){return new LinearLayout.LayoutParams(-1,dp(52));}
    private Button button(String label,boolean primary,Runnable run){
        Button b=new Button(this);b.setText(label);b.setAllCaps(false);b.setTextSize(15);b.setTextColor(Color.WHITE);
        b.setBackgroundTintList(android.content.res.ColorStateList.valueOf(primary?Color.rgb(54,105,76):Color.rgb(49,64,54)));
        b.setOnClickListener(v->run.run());return b;
    }
    private void showHome(){
        root=new FrameLayout(this);root.setBackgroundColor(Color.rgb(16,25,21));
        ScrollView scroll=new ScrollView(this);LinearLayout page=new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);page.setPadding(dp(22),dp(24),dp(22),dp(24));scroll.addView(page);
        TextView title=new TextView(this);title.setText("WAYWARD");title.setTextColor(Color.WHITE);title.setTextSize(29);title.setTypeface(null,1);page.addView(title);
        TextView desc=new TextView(this);desc.setText("게임 폴더 여러 개를 등록해 각각 독립된 실행 세션으로 엽니다.");desc.setTextColor(Color.rgb(174,194,181));desc.setTextSize(14);
        LinearLayout.LayoutParams dl=new LinearLayout.LayoutParams(-1,-2);dl.topMargin=dp(4);dl.bottomMargin=dp(18);page.addView(desc,dl);
        TextView detail=new TextView(this);detail.setText("게임 원본 폴더는 직접 읽기만 합니다. ZIP 모드는 압축을 풀지 않고 앱 내부 저장소에 보관한 뒤 WML 경로로 가상 제공됩니다.");detail.setTextColor(Color.rgb(214,224,217));detail.setTextSize(14);detail.setLineSpacing(dp(3),1f);page.addView(detail);
        status=new TextView(this);status.setTextColor(Color.rgb(245,210,130));status.setTextSize(13);status.setPadding(dp(13),dp(12),dp(13),dp(12));status.setBackgroundColor(Color.rgb(35,48,40));
        LinearLayout.LayoutParams sl=new LinearLayout.LayoutParams(-1,-2);sl.topMargin=dp(16);sl.bottomMargin=dp(8);page.addView(status,sl);
        folderText=new TextView(this);folderText.setTextColor(Color.rgb(160,180,166));folderText.setTextSize(12);LinearLayout.LayoutParams fl=new LinearLayout.LayoutParams(-1,-2);fl.bottomMargin=dp(12);page.addView(folderText,fl);
        page.addView(button("게임 폴더 추가",true,this::chooseFolder),buttonParams());

        TextView ptitle=new TextView(this);ptitle.setText("등록된 게임 폴더 · 독립 실행 세션");ptitle.setTextColor(Color.WHITE);ptitle.setTextSize(16);ptitle.setTypeface(null,1);
        LinearLayout.LayoutParams ptl=new LinearLayout.LayoutParams(-1,-2);ptl.topMargin=dp(22);ptl.bottomMargin=dp(7);page.addView(ptitle,ptl);
        profileSummary=new TextView(this);profileSummary.setTextColor(Color.rgb(160,180,166));profileSummary.setTextSize(12);page.addView(profileSummary);
        profileList=new LinearLayout(this);profileList.setOrientation(LinearLayout.VERTICAL);LinearLayout.LayoutParams pl=new LinearLayout.LayoutParams(-1,-2);pl.topMargin=dp(7);page.addView(profileList,pl);

        TextView ztitle=new TextView(this);ztitle.setText("앱 전용 ZIP 모드");ztitle.setTextColor(Color.WHITE);ztitle.setTextSize(16);ztitle.setTypeface(null,1);
        LinearLayout.LayoutParams ztl=new LinearLayout.LayoutParams(-1,-2);ztl.topMargin=dp(24);ztl.bottomMargin=dp(7);page.addView(ztitle,ztl);
        page.addView(button("모드 ZIP 설치 · 압축 해제 없이 앱에만 저장",false,this::chooseModZip),buttonParams());
        zipSummary=new TextView(this);zipSummary.setTextColor(Color.rgb(160,180,166));zipSummary.setTextSize(12);LinearLayout.LayoutParams zsl=new LinearLayout.LayoutParams(-1,-2);zsl.topMargin=dp(7);page.addView(zipSummary,zsl);
        zipModList=new LinearLayout(this);zipModList.setOrientation(LinearLayout.VERTICAL);LinearLayout.LayoutParams zpl=new LinearLayout.LayoutParams(-1,-2);zpl.topMargin=dp(6);page.addView(zipModList,zpl);

        TextView imageTitle=new TextView(this);imageTitle.setText("이미지 생성 서비스");imageTitle.setTextColor(Color.WHITE);imageTitle.setTextSize(16);imageTitle.setTypeface(null,1);
        LinearLayout.LayoutParams imageTitleParams=new LinearLayout.LayoutParams(-1,-2);imageTitleParams.topMargin=dp(24);imageTitleParams.bottomMargin=dp(7);page.addView(imageTitle,imageTitleParams);
        TextView imageDesc=new TextView(this);imageDesc.setText("Wayward ImageGen 0.8.4 서버를 런처 APK에 내장했습니다. 게임 폴더나 ZIP에서 서버를 찾지 않으며, NovelAI와 PC ComfyUI를 같은 내장 서버로 실행합니다.");imageDesc.setTextColor(Color.rgb(174,194,181));imageDesc.setTextSize(12);imageDesc.setLineSpacing(dp(2),1f);page.addView(imageDesc);
        page.addView(button("이미지 서비스 관리 · 등록 / 테스트",true,()->startActivity(new Intent(MainActivity.this,ImageProviderActivity.class))),buttonParams());
        page.addView(button("이미지 전달 진단 · 로그 보기",false,()->startActivity(new Intent(MainActivity.this,ImageDiagnosticsActivity.class))),buttonParams());
        TextView runtimeHint=new TextView(this);runtimeHint.setText("이미지 서버 자체는 인증정보 없이 먼저 실행됩니다. NovelAI 인증정보는 NovelAI 생성 경로에만 사용하며 Cloudflare FLUX는 별도 Worker 서비스의 자체 인증 설정만 사용합니다. ComfyUI 원격 연결도 독립 설정입니다. NovelAI 토큰을 서버 실행 후 변경했다면 새 토큰 적용을 위해 서버를 중지하고 다시 시작하세요.");runtimeHint.setTextColor(Color.rgb(174,194,181));runtimeHint.setTextSize(12);runtimeHint.setLineSpacing(dp(2),1f);LinearLayout.LayoutParams runtimeHintParams=new LinearLayout.LayoutParams(-1,-2);runtimeHintParams.topMargin=dp(10);page.addView(runtimeHint,runtimeHintParams);
        comfyUrlInput=new EditText(this);comfyUrlInput.setSingleLine(true);comfyUrlInput.setTextSize(14);comfyUrlInput.setTextColor(Color.WHITE);comfyUrlInput.setHintTextColor(Color.rgb(142,160,148));comfyUrlInput.setHint("http://PC의-LAN-IP:8188 또는 https://PC의-Tailscale-주소:8188");comfyUrlInput.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_URI);comfyUrlInput.setPadding(dp(12),dp(9),dp(12),dp(9));comfyUrlInput.setText(getSharedPreferences(PREFS,MODE_PRIVATE).getString(KEY_COMFY_URL,""));LinearLayout.LayoutParams comfyInputParams=new LinearLayout.LayoutParams(-1,dp(52));comfyInputParams.topMargin=dp(8);comfyInputParams.bottomMargin=dp(7);page.addView(comfyUrlInput,comfyInputParams);
        page.addView(button("NovelAI · 런처 내장 서버 실행",true,this::startNovelAiServer),buttonParams());
        page.addView(button("ComfyUI 연결 서버 실행",true,this::startComfyConnectionServer),buttonParams());
        page.addView(button("이미지 생성 설정 / 상태 열기",false,this::openImageGenPanel),buttonParams());
        imageGenStatus=new TextView(this);imageGenStatus.setTextColor(Color.rgb(245,210,130));imageGenStatus.setTextSize(12);imageGenStatus.setPadding(dp(10),dp(9),dp(10),dp(9));imageGenStatus.setBackgroundColor(Color.rgb(35,48,40));
        LinearLayout.LayoutParams imageStatusParams=new LinearLayout.LayoutParams(-1,-2);imageStatusParams.topMargin=dp(8);imageStatusParams.bottomMargin=dp(7);page.addView(imageGenStatus,imageStatusParams);
        page.addView(button("이미지 생성 서버 중지",false,this::stopImageGenServer),buttonParams());

        TextView help=new TextView(this);help.setText("ZIP 설치 위치: 이 앱의 비공개 files 저장소\n게임 폴더에는 ZIP이나 압축 해제 파일을 쓰지 않습니다. 설치한 모드는 등록된 게임 세션에서 공통으로 사용할 수 있으며, 모드 활성화/순서는 각 게임 세션의 브라우저 저장소에 따로 보관됩니다.");
        help.setTextColor(Color.rgb(151,171,158));help.setTextSize(12);help.setLineSpacing(dp(3),1f);LinearLayout.LayoutParams hl=new LinearLayout.LayoutParams(-1,-2);hl.topMargin=dp(18);page.addView(help,hl);
        home=page;root.addView(scroll,new FrameLayout.LayoutParams(-1,-1));setContentView(root);
        renderProfiles();renderZipMods();refreshImageGenStatus();
    }

    private Button compactButton(String label,boolean primary,Runnable action){
        Button b=new Button(this);b.setText(label);b.setAllCaps(false);b.setTextSize(12);b.setMinHeight(dp(42));
        b.setTextColor(Color.WHITE);b.setBackgroundTintList(android.content.res.ColorStateList.valueOf(primary?Color.rgb(54,105,76):Color.rgb(70,78,70)));
        b.setOnClickListener(v->action.run());return b;
    }

    private void chooseFolder(){
        Intent i=new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION|Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION|Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
        if(treeUri!=null)i.putExtra(DocumentsContract.EXTRA_INITIAL_URI,treeUri);
        else if(!profiles.isEmpty())try{i.putExtra(DocumentsContract.EXTRA_INITIAL_URI,Uri.parse(profiles.get(profiles.size()-1).uri));}catch(Exception ignored){}
        DiagnosticsLogger.event(this,"INFO","launcher","folder_picker_opened",null);
        startActivityForResult(i,PICK_TREE);
    }

    private void chooseModZip(){
        Intent i=new Intent(Intent.ACTION_OPEN_DOCUMENT);i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType("*/*");i.putExtra(Intent.EXTRA_MIME_TYPES,new String[]{"application/zip","application/x-zip-compressed","application/octet-stream"});i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE,true);
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        startActivityForResult(i,PICK_MOD_ZIP);
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
                refreshStatus();renderProfiles();renderZipMods();
                DiagnosticsLogger.event(this,"INFO","launcher","game_folder_registered",null);
                Toast.makeText(this,"게임 폴더를 등록했습니다. 목록에서 실행할 수 있습니다.",Toast.LENGTH_LONG).show();
            }catch(Exception e){DiagnosticsLogger.error(this,"launcher","folder_permission_failed",e);status("폴더 권한 저장 실패: "+msg(e));}
            return;
        }
        if(req==PICK_MOD_ZIP){
            if(result!=RESULT_OK||data==null)return;
            List<Uri> selected=collectSelectedUris(data);
            if(!selected.isEmpty())installModZips(selected);
        }
    }

    private List<Uri> collectSelectedUris(Intent data){
        List<Uri> selected=new ArrayList<>();
        ClipData clip=data.getClipData();
        if(clip!=null)for(int i=0;i<clip.getItemCount();i++){
            Uri uri=clip.getItemAt(i).getUri();
            if(uri!=null&&!selected.contains(uri))selected.add(uri);
        }
        Uri single=data.getData();
        if(single!=null&&!selected.contains(single))selected.add(single);
        return selected;
    }

    private String displayName(Uri uri){
        try(Cursor c=getContentResolver().query(uri,new String[]{OpenableColumns.DISPLAY_NAME},null,null,null)){
            if(c!=null&&c.moveToFirst())return c.getString(0);
        }catch(Exception ignored){}
        return "mod.zip";
    }

    private String installModZip(Uri uri)throws Exception{
        File staged=zipMods.temporaryFile(UUID.randomUUID().toString());
        try{
            String name=displayName(uri);
            if(name==null||!name.toLowerCase(Locale.ROOT).endsWith(".zip"))throw new IllegalArgumentException("확장자가 .zip인 모드 파일을 선택해 주세요.");
            try(InputStream in=getContentResolver().openInputStream(uri);FileOutputStream out=new FileOutputStream(staged)){
                if(in==null)throw new IllegalStateException("선택한 ZIP 파일을 열 수 없습니다.");
                byte[] buffer=new byte[32768];long total=0;int n;
                while((n=in.read(buffer))!=-1){total+=n;if(total>512L*1024L*1024L)throw new IllegalArgumentException("ZIP은 최대 512MB까지만 설치할 수 있습니다.");out.write(buffer,0,n);}
                out.flush();
            }
            ZipModStore.ModInfo info=ZipModStore.inspect(staged);
            zipMods.install(staged);
            return info.id;
        }finally{if(staged.exists())staged.delete();}
    }

    private void installModZips(List<Uri> sources){
        status("ZIP 모드를 앱 내부 저장소에 설치하고 있습니다...");
        new Thread(()->{
            List<String> installed=new ArrayList<>(),failed=new ArrayList<>();
            for(Uri uri:sources)try{installed.add(installModZip(uri));}catch(Exception e){failed.add(displayName(uri)+": "+msg(e));}
            runOnUiThread(()->{
                if(!installed.isEmpty()){
                    bumpZipRevision();renderZipMods();refreshStatus();
                    if(web!=null){loadedZipRevision=getZipRevision();web.reload();}
                }else refreshStatus();
                String report="ZIP 설치 "+installed.size()+"개 완료"+(failed.isEmpty()?"":" · 실패 "+failed.size()+"개: "+failed.get(0));
                Toast.makeText(this,report,Toast.LENGTH_LONG).show();
            });
        },"wml-zip-installer").start();
    }

    private long getZipRevision(){return getSharedPreferences(PREFS,MODE_PRIVATE).getLong(KEY_ZIP_REV,0);}
    private void bumpZipRevision(){getSharedPreferences(PREFS,MODE_PRIVATE).edit().putLong(KEY_ZIP_REV,getZipRevision()+1).apply();}

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
        if(profileList==null)return;profileList.removeAllViews();
        if(profileSummary!=null)profileSummary.setText("등록된 폴더 "+profiles.size()+"개 · 각 폴더는 최근 앱에서 별도 창으로 유지됩니다.");
        if(profiles.isEmpty()){
            TextView empty=new TextView(this);empty.setText("등록된 게임 폴더가 없습니다. 위 버튼으로 Wayward 또는 Faith 폴더를 추가하세요.");
            empty.setTextColor(Color.rgb(151,171,158));empty.setTextSize(12);profileList.addView(empty);return;
        }
        for(GameProfile p:profiles){
            LinearLayout card=new LinearLayout(this);card.setOrientation(LinearLayout.HORIZONTAL);card.setGravity(android.view.Gravity.CENTER_VERTICAL);
            card.setPadding(dp(8),dp(5),dp(5),dp(5));card.setBackgroundColor(Color.rgb(29,43,35));
            LinearLayout.LayoutParams cl=new LinearLayout.LayoutParams(-1,-2);cl.bottomMargin=dp(6);profileList.addView(card,cl);
            TextView label=new TextView(this);label.setText(p.label);label.setTextColor(Color.WHITE);label.setTextSize(13);label.setMaxLines(2);
            card.addView(label,new LinearLayout.LayoutParams(0,dp(48),1f));
            Button start=compactButton("실행",true,()->launchProfileSession(p.id));card.addView(start,new LinearLayout.LayoutParams(dp(72),dp(48)));
            Button remove=compactButton("삭제",false,()->removeProfile(p.id));LinearLayout.LayoutParams rl=new LinearLayout.LayoutParams(dp(72),dp(48));rl.leftMargin=dp(4);card.addView(remove,rl);
        }
    }

    private void renderZipMods(){
        if(zipModList==null||zipMods==null)return;zipModList.removeAllViews();
        List<String> ids=zipMods.listModIds();
        if(zipSummary!=null)zipSummary.setText("앱 전용 ZIP 모드 "+ids.size()+"개 · 게임 폴더에는 파일을 풀거나 쓰지 않습니다.");
        if(ids.isEmpty()){
            TextView empty=new TextView(this);empty.setText("아직 설치된 ZIP 모드가 없습니다.");empty.setTextColor(Color.rgb(151,171,158));empty.setTextSize(12);zipModList.addView(empty);return;
        }
        for(String id:ids){
            LinearLayout row=new LinearLayout(this);row.setOrientation(LinearLayout.HORIZONTAL);row.setGravity(android.view.Gravity.CENTER_VERTICAL);
            TextView label=new TextView(this);label.setText(id);label.setTextColor(Color.rgb(214,224,217));label.setTextSize(13);
            row.addView(label,new LinearLayout.LayoutParams(0,dp(44),1f));
            Button remove=compactButton("ZIP 제거",false,()->{
                if(zipMods.uninstall(id)){bumpZipRevision();renderZipMods();refreshStatus();if(web!=null){loadedZipRevision=getZipRevision();web.reload();}}
                else Toast.makeText(this,"ZIP 모드를 제거하지 못했습니다.",Toast.LENGTH_SHORT).show();
            });
            row.addView(remove,new LinearLayout.LayoutParams(dp(100),dp(44)));zipModList.addView(row);
        }
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
        ids.add(BUILTIN_COMPANIONS_MOD_ID);
        return new ArrayList<>(ids);
    }
    private void refreshStatus(){
        if(tree==null){
            status("등록된 게임 폴더 "+profiles.size()+"개 · 앱 전용 ZIP 모드 "+(zipMods==null?0:zipMods.listModIds().size())+"개");
            if(folderText!=null)folderText.setText("");return;
        }
        try{
            String f=gameFile();status(f==null?"게임 HTML을 찾지 못했습니다.":"게임 확인 완료 · 인식 가능한 WML 모드 "+allModIds().size()+"개");
            if(folderText!=null)folderText.setText("선택 폴더: "+tree.rootName()+"\n실행 파일: "+(f==null?"없음":f));
        }catch(Exception e){status("폴더를 읽을 수 없습니다. "+msg(e));}
    }
    private void refreshGame(){if(web!=null&&web.getVisibility()==View.VISIBLE){if(tree!=null)tree.invalidateDirectoryIndex();web.clearCache(true);web.reload();Toast.makeText(this,"게임과 앱 전용 ZIP 모드 및 이미지 캐시를 새로 읽습니다.",Toast.LENGTH_SHORT).show();}else refreshStatus();}

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

    private void installImageGenDocumentStartScript(String origin) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            if (imageGenStatus != null) imageGenStatus.setText("이 Android System WebView는 이미지 서버 연결 스크립트를 지원하지 않습니다. WebView 업데이트가 필요합니다.");
            return;
        }
        try {
            for (String assetName : new String[] {"imagegen-proxy.js", "image-provider-bridge.js"}) {
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

        final String version;
        try {
            String detected = imageStudioModId(sessionTree);
            if (detected == null) {
                imageGenSessionMessage = "현재 세션의 WML Image Studio 모드가 없어 이미지 서버를 시작하지 않았습니다.";
                refreshImageGenStatus();
                finishImageGenCallbacks();
                return;
            }
            // Start the local EasyGen/NovelAI-compatible server independently
            // of credentials. The provider is configured after the panel opens.
            version = "launcher-imagegen:" + ImageGenBackendInstaller.VERSION + ":novelai";
        } catch (Exception e) {
            imageGenSessionMessage = "현재 세션의 Image Studio 모드 검사 실패: " + msg(e);
            refreshImageGenStatus();
            finishImageGenCallbacks();
            return;
        }

        ImageGenStatusStore.State shared = ImageGenStatusStore.read(getFilesDir());
        if (shared.isReady() || shared.isStarting()) {
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
            if (shared.isReady() || shared.isStarting()) {
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
                writeImageGenRuntimeConfig(backend, "novelai", "");
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
                startImageGenService(backend, version, "novelai", "");
                waitForImageGenReady();
            });
        }, "wayward-imagegen-session-prepare").start();
    }

    private static boolean sameImageGenVersion(String running, String requested) {
        if(running==null||requested==null||running.isEmpty()||requested.isEmpty())return false;
        // The engine mode is part of the version identity: NovelAI and ComfyUI
        // share code but have different active provider configuration.
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
                boolean finished = state.isReady()
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
        boolean sameMode=running.backendVersion!=null&&running.backendVersion.endsWith(":"+mode);
        if(running.isStarting()){
            imageGenSessionMessage="이미 이미지 서버를 시작하고 있습니다. 준비가 끝난 뒤 다시 시도해 주세요.";
            refreshImageGenStatus();
            return;
        }
        if(running.isReady()&&sameMode&&!endpointChanged){
            imageGenSessionMessage="런처 내장 "+("comfy".equals(mode)?"ComfyUI 중계":"NovelAI")+" 서버가 이미 실행 중입니다.";
            refreshImageGenStatus();
            Toast.makeText(this,imageGenSessionMessage,Toast.LENGTH_SHORT).show();
            return;
        }
        if("comfy".equals(mode)){
            getSharedPreferences(PREFS,MODE_PRIVATE).edit().putString(KEY_COMFY_URL,endpoint).apply();
        }
        if(running.isReady()){
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
        if(!state.isReady()&&!state.isStarting()){
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
        ImageGenStatusStore.State state=ImageGenStatusStore.read(getFilesDir());
        if(!state.isReady()){
            Toast.makeText(this,"먼저 NovelAI 또는 ComfyUI 연결 서버를 실행해 주세요.",Toast.LENGTH_LONG).show();
            return;
        }
        Intent intent=new Intent(this,ImageGenPanelActivity.class);
        intent.putExtra(ImageGenPanelActivity.EXTRA_MODE,state.backendVersion.endsWith(":comfy")?"comfy":"novelai");
        startActivity(intent);
    }

    private void startManagedImageGenServer(String mode,String comfyUrl){
        if (!"novelai".equals(mode) && !"comfy".equals(mode)) {
            imageGenSessionMessage = "지원하지 않는 이미지 생성 서버 모드입니다.";
            refreshImageGenStatus();
            return;
        }
        synchronized(IMAGEGEN_LOCK){
            ImageGenStatusStore.State running=ImageGenStatusStore.read(getFilesDir());
            if(running.isReady()||running.isStarting()){
                imageGenSessionMessage="이미 런처 내장 이미지 서버가 실행 중입니다. ComfyUI 주소를 바꾸려면 주소를 입력한 뒤 연결 버튼을 누르세요.";
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
        imageGenSessionMessage=("novelai".equals(mode)?"NovelAI":"ComfyUI 연결")+" 런처 내장 서버를 준비하고 있습니다…";
        refreshImageGenStatus();
        new Thread(()->{
            String failure=null;
            try{
                ImageGenBackendInstaller.install(this,backend);
                // Server availability is independent of provider credentials.
                // NovelAI credentials are supplied only to the NovelAI runtime;
                // Cloudflare FLUX uses its own ImageProviderStore provider record.
                writeImageGenRuntimeConfig(backend,mode,requestedUrl);
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
                String launchVersion="launcher-imagegen:"+ImageGenBackendInstaller.VERSION+":"+mode;
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
                startImageGenService(backend,launchVersion,mode,requestedUrl);
                manualImageGenPreparing=false;
                refreshImageGenStatus();
                waitForImageGenReady();
            });
        },"wayward-imagegen-bundled-prepare").start();
    }

    private void writeImageGenRuntimeConfig(File backend,String mode,String comfyUrl)throws Exception{
        File project=new File(backend,"wayward-imagegen");
        if(!new File(project,"src/cli.ts").isFile())throw new IllegalStateException("내장 wayward-imagegen/src/cli.ts가 없습니다.");
        JSONObject config=new JSONObject();
        config.put("host","127.0.0.1");
        config.put("port",8189);
        config.put("imagesDir",new File(getFilesDir(),"imagegen/images").getAbsolutePath());
        config.put("stateDir",new File(getFilesDir(),"imagegen/state").getAbsolutePath());
        config.put("comfyUrl",comfyUrl==null||comfyUrl.isEmpty()?"http://127.0.0.1:8188":comfyUrl);
        config.put("imageProvider","novelai".equals(mode)?"nai":"sdxl");
        // Android has no bundled sharp binary; PNG is the supported no-dependency path.
        config.put("webp",false);
        config.put("requireWebp",false);
        File images=new File(getFilesDir(),"imagegen/images");
        File state=new File(getFilesDir(),"imagegen/state");
        if(!images.isDirectory()&&!images.mkdirs()&&!images.isDirectory())throw new IllegalStateException("이미지 저장 폴더를 만들지 못했습니다.");
        if(!state.isDirectory()&&!state.mkdirs()&&!state.isDirectory())throw new IllegalStateException("이미지 상태 폴더를 만들지 못했습니다.");
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

    private void startImageGenService(File backend, String version) {
        startImageGenService(backend,version,"default","");
    }

    private void startImageGenService(File backend,String version,String launchMode,String comfyUrl){
        Intent intent = new Intent(this, ImageGenService.class);
        intent.setAction(ImageGenService.ACTION_START);
        intent.putExtra(ImageGenService.EXTRA_BACKEND_ROOT, backend.getAbsolutePath());
        intent.putExtra(ImageGenService.EXTRA_BACKEND_VERSION, version);
        intent.putExtra(ImageGenService.EXTRA_LAUNCH_MODE, launchMode);
        intent.putExtra(ImageGenService.EXTRA_COMFY_URL, comfyUrl==null?"":comfyUrl);
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
        private static final String CORE="wml/runtime/wml-core.js";private final SafTree tree;private final android.content.res.AssetManager assets;private final ZipModStore zipMods;private final String origin;
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
            if(tree==null)return response(404,"Not Found","text/plain","Not found");
            try{
                String p=normal(raw);
                if(p==null)return response(404,"Not Found","text/plain","Not found");
                InputStream in=isImageAssetPath(p)?tree.openImage(p):tree.open(p);
                if(in==null&&zipMods!=null)in=zipMods.open(p);
                if(in==null&&BUILTIN_COMPANIONS_MOD_FILE.equals(p))in=assets.open("launcher-companions-mobile-ui.js");
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
        InputStream openImage(String p)throws Exception{Node n=resolveImage(p);if(n==null||n.dir)return null;return getContentResolver().openInputStream(DocumentsContract.buildDocumentUriUsingTree(tree,n.id));}
        private Node resolveImage(String path)throws Exception{
            String p=FolderHandler.normal(path);if(p==null)return null;
            String parent=rootId;Node n=null;String[] parts=p.split("/");
            for(int i=0;i<parts.length;i++){
                n=findIgnoreCase(parent,parts[i]);if(n==null)return null;
                if(i<parts.length-1){if(!n.dir)return null;parent=n.id;}
            }
            return n;
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
            directoryQuerySlots.acquire();
            try{
                Uri u=DocumentsContract.buildChildDocumentsUriUsingTree(tree,parent);
                try(Cursor c=getContentResolver().query(u,new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID,DocumentsContract.Document.COLUMN_DISPLAY_NAME,DocumentsContract.Document.COLUMN_MIME_TYPE},null,null,null)){
                    if(c!=null)while(c.moveToNext()){
                        String name=c.getString(1);if(name==null||name.isEmpty())continue;
                        loaded.put(name,new Node(c.getString(0),name,DocumentsContract.Document.MIME_TYPE_DIR.equals(c.getString(2))));
                    }
                }
            }finally{
                directoryQuerySlots.release();
            }
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
        Node node(String id)throws Exception{Uri u=DocumentsContract.buildDocumentUriUsingTree(tree,id);try(Cursor c=getContentResolver().query(u,new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID,DocumentsContract.Document.COLUMN_DISPLAY_NAME,DocumentsContract.Document.COLUMN_MIME_TYPE},null,null,null)){if(c==null||!c.moveToFirst())return new Node(id,"Wayward",true);return new Node(c.getString(0),c.getString(1),DocumentsContract.Document.MIME_TYPE_DIR.equals(c.getString(2)));}}
    }
    private static final class Node{final String id,name;final boolean dir;Node(String i,String n,boolean d){id=i;name=n;dir=d;}}
}
