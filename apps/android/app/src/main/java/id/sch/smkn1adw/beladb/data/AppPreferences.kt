package id.sch.smkn1adw.beladb.data

import android.content.Context

class AppPreferences(context: Context) {
    private val prefs = context.getSharedPreferences("bel_adb_prefs", Context.MODE_PRIVATE)

    var serverUrl: String
        get() = prefs.getString(KEY_SERVER_URL, DEFAULT_SERVER_URL) ?: DEFAULT_SERVER_URL
        set(value) {
            prefs.edit().putString(KEY_SERVER_URL, normalizeUrl(value)).apply()
        }

    var authToken: String?
        get() = prefs.getString(KEY_AUTH_TOKEN, null)
        set(value) {
            if (value == null) {
                prefs.edit().remove(KEY_AUTH_TOKEN).apply()
            } else {
                prefs.edit().putString(KEY_AUTH_TOKEN, value).apply()
            }
        }

    companion object {
        const val DEFAULT_SERVER_URL = "http://202.65.116.9:7029"
        private const val KEY_SERVER_URL = "server_url"
        private const val KEY_AUTH_TOKEN = "auth_token"

        fun normalizeUrl(raw: String): String {
            val trimmed = raw.trim().trimEnd('/')
            if (trimmed.isEmpty()) return DEFAULT_SERVER_URL
            return if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
                trimmed
            } else {
                "http://$trimmed"
            }
        }
    }
}
