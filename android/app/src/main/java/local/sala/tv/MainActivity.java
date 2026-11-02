package local.sala.tv;

import android.app.Activity;
import android.content.pm.ApplicationInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;

/**
 * Receptor M I.A. Shared View para Android TV, Google TV, Fire TV e TV Box.
 * Abre o mesmo receptor web da Samsung (assets/index.html) e acrescenta o que o WebView não faz sozinho:
 * nome do aparelho, botão Voltar e descoberta do computador pelo anúncio UDP do app Windows.
 */
public class MainActivity extends Activity {
    private static final int DISCOVERY_PORT = 8788;
    private WebView web;
    private DatagramSocket discoverySocket;
    private WifiManager.MulticastLock multicastLock;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) WebView.setWebContentsDebuggingEnabled(true);

        web = new WebView(this);
        web.setBackgroundColor(0xFF0B101B);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true); // id da TV e computadores autorizados ficam no localStorage
        settings.setMediaPlaybackRequiresUserGesture(false); // vídeo e som começam sem apertar OK
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return true; // o receptor nunca navega para fora dos assets
            }
        });
        web.addJavascriptInterface(new Bridge(), "SalaAndroid");
        setContentView(web);
        hideSystemUi();
        web.loadUrl("file:///android_asset/index.html");
        startDiscovery();
    }

    private void hideSystemUi() {
        web.setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
    }

    /** Escuta o anúncio do app Windows ({"app":"sala-tv","port":8787}) e entrega a URL ao receptor. */
    private void startDiscovery() {
        WifiManager wifi = (WifiManager) getApplicationContext().getSystemService(WIFI_SERVICE);
        if (wifi != null) {
            multicastLock = wifi.createMulticastLock("sala-tv");
            multicastLock.setReferenceCounted(false);
            multicastLock.acquire();
        }
        Thread thread = new Thread(() -> {
            try {
                discoverySocket = new DatagramSocket(null);
                discoverySocket.setReuseAddress(true);
                discoverySocket.setBroadcast(true);
                discoverySocket.bind(new InetSocketAddress(DISCOVERY_PORT));
                byte[] buffer = new byte[512];
                String last = null;
                while (!discoverySocket.isClosed()) {
                    DatagramPacket packet = new DatagramPacket(buffer, buffer.length);
                    discoverySocket.receive(packet);
                    JSONObject beacon = new JSONObject(new String(packet.getData(), 0, packet.getLength(), StandardCharsets.UTF_8));
                    int port = beacon.optInt("port", 0);
                    String address = packet.getAddress().getHostAddress();
                    if (!"sala-tv".equals(beacon.optString("app")) || port <= 0 || port > 65535 || address == null || !address.matches("[0-9.]+")) continue;
                    String url = "http://" + address + ":" + port;
                    if (url.equals(last)) continue; // anúncio repetido a cada 2 s
                    last = url;
                    runOnUiThread(() -> web.evaluateJavascript("window.salaDiscovered && salaDiscovered('" + url + "')", null));
                }
            } catch (Exception ignored) {
                // socket fechado no onDestroy ou rede indisponível: sem descoberta, o endereço salvo continua valendo
            }
        }, "sala-discovery");
        thread.setDaemon(true);
        thread.start();
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            // O receptor decide: recusa um pedido aberto ou pede um segundo Voltar (2 s) antes de sair.
            web.evaluateJavascript("window.salaBack ? salaBack() : false", handled -> { if (!"true".equals(handled)) finish(); });
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemUi();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    protected void onPause() {
        web.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (discoverySocket != null) discoverySocket.close();
        if (multicastLock != null && multicastLock.isHeld()) multicastLock.release();
        web.destroy();
        super.onDestroy();
    }

    /** Exposto ao receptor como window.SalaAndroid. */
    private class Bridge {
        @JavascriptInterface
        public String deviceName() {
            String name = null;
            if (Build.VERSION.SDK_INT >= 25) name = Settings.Global.getString(getContentResolver(), Settings.Global.DEVICE_NAME);
            if (name == null || name.trim().isEmpty()) name = Build.MANUFACTURER + " " + Build.MODEL;
            return name.trim();
        }
    }
}
