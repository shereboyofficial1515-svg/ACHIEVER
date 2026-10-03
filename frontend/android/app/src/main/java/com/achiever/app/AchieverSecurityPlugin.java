package com.achiever.app;

import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyPermanentlyInvalidatedException;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.view.WindowManager;

import androidx.annotation.NonNull;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.nio.charset.StandardCharsets;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.PublicKey;
import java.security.Signature;
import java.security.spec.ECGenParameterSpec;

/**
 * ACHIEVER device security (Android only).
 *
 * Biometric sign-in and payment approval use an EC P-256 key created inside
 * the Android Keystore. The private key never leaves the secure hardware and
 * can only be used after the user passes a biometric (or, on Android 11+,
 * device credential) check. Enrolling a new fingerprint/face invalidates it.
 * No biometric data is ever read or sent anywhere: Android only tells us
 * that the check passed, and the key then signs the server's challenge.
 */
@CapacitorPlugin(name = "AchieverSecurity")
public class AchieverSecurityPlugin extends Plugin {
    private static final String KEYSTORE = "AndroidKeyStore";

    private int strongAuthenticators() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
            ? BiometricManager.Authenticators.BIOMETRIC_STRONG | BiometricManager.Authenticators.DEVICE_CREDENTIAL
            : BiometricManager.Authenticators.BIOMETRIC_STRONG;
    }

    @PluginMethod
    public void status(PluginCall call) {
        BiometricManager bm = BiometricManager.from(getContext());
        int strong = bm.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG);
        int any = bm.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_WEAK | BiometricManager.Authenticators.DEVICE_CREDENTIAL);
        JSObject r = new JSObject();
        r.put("available", strong == BiometricManager.BIOMETRIC_SUCCESS);
        r.put("enrolled", strong != BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED);
        r.put("hardware", strong != BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE && strong != BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE);
        r.put("deviceCredential", any == BiometricManager.BIOMETRIC_SUCCESS);
        r.put("reason", reason(strong));
        call.resolve(r);
    }

    private String reason(int code) {
        switch (code) {
            case BiometricManager.BIOMETRIC_SUCCESS: return "ok";
            case BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED: return "none_enrolled";
            case BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE: return "no_hardware";
            case BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE: return "hardware_unavailable";
            case BiometricManager.BIOMETRIC_ERROR_SECURITY_UPDATE_REQUIRED: return "security_update_required";
            default: return "unavailable";
        }
    }

    private static boolean validAlias(String alias) {
        return alias != null && alias.matches("^achiever-[a-z0-9-]{1,60}$");
    }

    /** Creates (replacing any old one) the signing key and returns its public key (SPKI, base64). */
    @PluginMethod
    public void createKey(PluginCall call) {
        String alias = call.getString("alias");
        if (!validAlias(alias)) { call.reject("Invalid key alias", "INVALID_ALIAS"); return; }
        try {
            KeyStore ks = KeyStore.getInstance(KEYSTORE);
            ks.load(null);
            if (ks.containsAlias(alias)) ks.deleteEntry(alias);
            KeyGenParameterSpec.Builder spec = new KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_SIGN)
                .setAlgorithmParameterSpec(new ECGenParameterSpec("secp256r1"))
                .setDigests(KeyProperties.DIGEST_SHA256)
                .setUserAuthenticationRequired(true)
                .setInvalidatedByBiometricEnrollment(true);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                // Every use needs a fresh check (timeout 0).
                spec.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG | KeyProperties.AUTH_DEVICE_CREDENTIAL);
            }
            KeyPairGenerator kpg = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, KEYSTORE);
            kpg.initialize(spec.build());
            PublicKey pub = kpg.generateKeyPair().getPublic();
            JSObject r = new JSObject();
            r.put("publicKey", Base64.encodeToString(pub.getEncoded(), Base64.NO_WRAP));
            call.resolve(r);
        } catch (Exception e) {
            call.reject("Could not create a secure key on this device", "KEY_CREATE_FAILED");
        }
    }

    @PluginMethod
    public void hasKey(PluginCall call) {
        String alias = call.getString("alias");
        JSObject r = new JSObject();
        try {
            KeyStore ks = KeyStore.getInstance(KEYSTORE);
            ks.load(null);
            r.put("exists", validAlias(alias) && ks.containsAlias(alias));
        } catch (Exception e) {
            r.put("exists", false);
        }
        call.resolve(r);
    }

    @PluginMethod
    public void deleteKey(PluginCall call) {
        String alias = call.getString("alias");
        try {
            KeyStore ks = KeyStore.getInstance(KEYSTORE);
            ks.load(null);
            if (validAlias(alias) && ks.containsAlias(alias)) ks.deleteEntry(alias);
        } catch (Exception ignored) {
            // nothing to delete
        }
        call.resolve();
    }

    /** Shows the system biometric prompt; on success signs the payload (UTF-8) with the key. */
    @PluginMethod
    public void sign(PluginCall call) {
        String alias = call.getString("alias");
        String payload = call.getString("payload");
        if (!validAlias(alias) || payload == null || payload.length() > 1000) { call.reject("Invalid request", "INVALID_REQUEST"); return; }
        final Signature signature;
        try {
            KeyStore ks = KeyStore.getInstance(KEYSTORE);
            ks.load(null);
            PrivateKey key = (PrivateKey) ks.getKey(alias, null);
            if (key == null) { call.reject("Biometrics are not set up on this device", "KEY_MISSING"); return; }
            signature = Signature.getInstance("SHA256withECDSA");
            signature.initSign(key);
        } catch (KeyPermanentlyInvalidatedException e) {
            call.reject("Your fingerprints or face data changed. Turn biometrics on again.", "KEY_INVALIDATED");
            return;
        } catch (Exception e) {
            call.reject("Biometric approval is not available", "KEY_UNAVAILABLE");
            return;
        }
        getActivity().runOnUiThread(() -> prompt(call, new BiometricPrompt.CryptoObject(signature), strongAuthenticators(), (result) -> {
            try {
                Signature s = result.getCryptoObject().getSignature();
                s.update(payload.getBytes(StandardCharsets.UTF_8));
                JSObject r = new JSObject();
                r.put("signature", Base64.encodeToString(s.sign(), Base64.NO_WRAP));
                call.resolve(r);
            } catch (Exception e) {
                call.reject("Biometric approval failed", "SIGN_FAILED");
            }
        }));
    }

    /** App lock: a plain biometric / screen-lock check (no key), used when returning to the app. */
    @PluginMethod
    public void authenticate(PluginCall call) {
        int allowed = BiometricManager.Authenticators.BIOMETRIC_WEAK | BiometricManager.Authenticators.DEVICE_CREDENTIAL;
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) allowed = BiometricManager.Authenticators.BIOMETRIC_WEAK;
        final int authenticators = allowed;
        getActivity().runOnUiThread(() -> prompt(call, null, authenticators, (result) -> call.resolve()));
    }

    private interface OnSuccess { void run(BiometricPrompt.AuthenticationResult result); }

    private void prompt(PluginCall call, BiometricPrompt.CryptoObject crypto, int authenticators, OnSuccess onSuccess) {
        FragmentActivity activity = (FragmentActivity) getActivity();
        BiometricPrompt bp = new BiometricPrompt(activity, ContextCompat.getMainExecutor(getContext()), new BiometricPrompt.AuthenticationCallback() {
            @Override
            public void onAuthenticationSucceeded(@NonNull BiometricPrompt.AuthenticationResult result) {
                onSuccess.run(result);
            }

            @Override
            public void onAuthenticationError(int code, @NonNull CharSequence message) {
                boolean cancelled = code == BiometricPrompt.ERROR_USER_CANCELED || code == BiometricPrompt.ERROR_NEGATIVE_BUTTON || code == BiometricPrompt.ERROR_CANCELED;
                boolean locked = code == BiometricPrompt.ERROR_LOCKOUT || code == BiometricPrompt.ERROR_LOCKOUT_PERMANENT;
                call.reject(message.toString(), cancelled ? "CANCELLED" : locked ? "LOCKED_OUT" : "BIOMETRIC_ERROR");
            }
            // onAuthenticationFailed (one unrecognised finger) keeps the prompt open.
        });
        BiometricPrompt.PromptInfo.Builder info = new BiometricPrompt.PromptInfo.Builder()
            .setTitle(call.getString("title", "Confirm it's you"))
            .setSubtitle(call.getString("subtitle", "ACHIEVER"))
            .setAllowedAuthenticators(authenticators)
            .setConfirmationRequired(true);
        if ((authenticators & BiometricManager.Authenticators.DEVICE_CREDENTIAL) == 0) {
            info.setNegativeButtonText(call.getString("cancelText", "Use PIN instead"));
        }
        try {
            if (crypto != null) bp.authenticate(info.build(), crypto); else bp.authenticate(info.build());
        } catch (Exception e) {
            call.reject("Biometric prompt could not be shown", "BIOMETRIC_ERROR");
        }
    }

    /** Writes the WebView's cookies (the HTTP-only session) to disk now, e.g. right after sign-in. */
    @PluginMethod
    public void flushCookies(PluginCall call) {
        android.webkit.CookieManager.getInstance().flush();
        call.resolve();
    }

    /**
     * A short key-press vibration for the secure keypad. Uses the view's haptic
     * feedback (no VIBRATE permission) and respects the phone's own touch-feedback setting.
     */
    @PluginMethod
    public void haptic(PluginCall call) {
        String kind = call.getString("kind", "tap");
        getActivity().runOnUiThread(() -> {
            int effect = "confirm".equals(kind) && Build.VERSION.SDK_INT >= 30 ? android.view.HapticFeedbackConstants.CONFIRM
                : "reject".equals(kind) && Build.VERSION.SDK_INT >= 30 ? android.view.HapticFeedbackConstants.REJECT
                : android.view.HapticFeedbackConstants.KEYBOARD_TAP;
            bridge.getWebView().performHapticFeedback(effect);
            call.resolve();
        });
    }

    /**
     * Share a generated receipt (PNG or PDF) through the Android share sheet.
     * The file is written to the app's private cache, checked (exists, not
     * empty), and offered to other apps through the FileProvider with a
     * read-only grant. Old receipt files are removed on the next share.
     */
    @PluginMethod
    public void shareFile(PluginCall call) {
        String data = call.getString("data");
        String filename = call.getString("filename", "ACHIEVER-Receipt");
        String mimeType = call.getString("mimeType", "application/octet-stream");
        String title = call.getString("title", "Share receipt");
        if (data == null || data.isEmpty() || !filename.matches("[A-Za-z0-9._-]{1,120}")
                || !("image/png".equals(mimeType) || "application/pdf".equals(mimeType))) {
            call.reject("Invalid file", "INVALID_FILE");
            return;
        }
        try {
            java.io.File dir = new java.io.File(getContext().getCacheDir(), "receipts");
            if (!dir.exists() && !dir.mkdirs()) { call.reject("Could not prepare storage", "STORAGE_ERROR"); return; }
            long cutoff = System.currentTimeMillis() - 60L * 60L * 1000L;
            java.io.File[] old = dir.listFiles();
            if (old != null) for (java.io.File f : old) if (f.lastModified() < cutoff) f.delete();

            byte[] bytes = Base64.decode(data, Base64.DEFAULT);
            java.io.File file = new java.io.File(dir, filename);
            try (java.io.FileOutputStream out = new java.io.FileOutputStream(file)) { out.write(bytes); }
            if (!file.exists() || file.length() == 0) { call.reject("The receipt file was not created", "FILE_EMPTY"); return; }

            android.net.Uri uri = androidx.core.content.FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
            android.content.Intent send = new android.content.Intent(android.content.Intent.ACTION_SEND);
            send.setType(mimeType);
            send.putExtra(android.content.Intent.EXTRA_STREAM, uri);
            send.putExtra(android.content.Intent.EXTRA_SUBJECT, title);
            send.setClipData(android.content.ClipData.newRawUri(filename, uri));
            send.addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION);
            android.content.Intent chooser = android.content.Intent.createChooser(send, title);
            chooser.addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().startActivity(chooser);
            JSObject ret = new JSObject();
            ret.put("size", file.length());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Could not share the receipt", "SHARE_FAILED");
        }
    }

    /** Hides the screen from screenshots and the recent-apps preview (tokens, PINs, approvals). */
    @PluginMethod
    public void setSecureScreen(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        getActivity().runOnUiThread(() -> {
            if (enabled) getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
            else getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
            call.resolve();
        });
    }
}
