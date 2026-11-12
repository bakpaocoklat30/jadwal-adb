package id.sch.smkn1adw.beladb.data

import io.socket.client.IO
import io.socket.client.Socket
import kotlinx.serialization.json.Json
import org.json.JSONArray
import org.json.JSONObject

class SocketClient(private val json: Json) {
    private var socket: Socket? = null

    fun connect(
        serverUrl: String,
        token: String,
        onConnectionChanged: (Boolean) -> Unit,
        onScheduleUpdated: (ScheduleSnapshot) -> Unit,
        onDeviceStatus: (DeviceStatus) -> Unit,
        onAudioManifestUpdated: (List<AudioFileEntry>) -> Unit,
        onServerAudioUpdated: (List<ServerAudioFile>) -> Unit,
        onLogsUpdated: (List<BellLog>) -> Unit
    ) {
        disconnect()

        val normalizedUrl = AppPreferences.normalizeUrl(serverUrl)
        val options = IO.Options.builder()
            .setAuth(mapOf("kind" to "user", "token" to token))
            .setReconnection(true)
            .setReconnectionDelay(3000)
            .setReconnectionDelayMax(15000)
            .build()

        val client = IO.socket(normalizedUrl, options)
        socket = client

        client.on(Socket.EVENT_CONNECT) {
            onConnectionChanged(true)
        }

        client.on(Socket.EVENT_DISCONNECT) {
            onConnectionChanged(false)
        }

        client.on(Socket.EVENT_CONNECT_ERROR) {
            onConnectionChanged(false)
        }

        client.on("schedule:updated") { args ->
            val obj = args.firstOrNull() as? JSONObject ?: return@on
            runCatching {
                val res = json.decodeFromString<SnapshotResponse>(obj.toString())
                onScheduleUpdated(res.snapshot)
            }
        }

        client.on("device:status") { args ->
            val obj = args.firstOrNull() as? JSONObject ?: return@on
            runCatching {
                val status = json.decodeFromString<DeviceStatus>(obj.toString())
                onDeviceStatus(status)
            }
        }

        client.on("audio:updated") { args ->
            val arr = args.firstOrNull() as? JSONArray ?: return@on
            runCatching {
                val list = json.decodeFromString<List<AudioFileEntry>>(arr.toString())
                onAudioManifestUpdated(list)
            }
        }

        client.on("server_audio:updated") { args ->
            val arr = args.firstOrNull() as? JSONArray ?: return@on
            runCatching {
                val list = json.decodeFromString<List<ServerAudioFile>>(arr.toString())
                onServerAudioUpdated(list)
            }
        }

        client.on("logs:updated") { args ->
            val arr = args.firstOrNull() as? JSONArray ?: return@on
            runCatching {
                val list = json.decodeFromString<List<BellLog>>(arr.toString())
                onLogsUpdated(list)
            }
        }

        client.connect()
    }

    fun disconnect() {
        socket?.let {
            it.off()
            it.disconnect()
        }
        socket = null
    }
}
