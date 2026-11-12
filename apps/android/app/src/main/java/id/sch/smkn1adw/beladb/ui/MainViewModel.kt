package id.sch.smkn1adw.beladb.ui

import android.annotation.SuppressLint
import android.app.Application
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaPlayer
import android.media.MediaRecorder
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import android.util.Base64
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import id.sch.smkn1adw.beladb.data.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import kotlin.math.PI
import kotlin.math.exp
import kotlin.math.sin

data class MainUiState(
    val initializing: Boolean = true,
    val serverUrl: String = AppPreferences.DEFAULT_SERVER_URL,
    val user: UserPublic? = null,
    val socketConnected: Boolean = false,
    val isRefreshing: Boolean = false,
    val isBusy: Boolean = false,
    val snapshot: ScheduleSnapshot? = null,
    val deviceStatus: DeviceStatus = DeviceStatus(),
    val localAudioFiles: List<AudioFileEntry> = emptyList(),
    val serverAudioFiles: List<ServerAudioFile> = emptyList(),
    val logs: List<BellLog> = emptyList(),
    val users: List<UserPublic> = emptyList(),
    val deviceToken: String? = null,
    val backupSettings: BackupSettings? = null,
    val backupFiles: List<BackupFileInfo> = emptyList(),
    val previewingFileName: String? = null,
    val isRecordingVoiceNote: Boolean = false,
    val voiceNoteDurationSec: Int = 0,
    val hasRecordedVoiceNote: Boolean = false,
    val isPreviewingVoiceNote: Boolean = false,
    val isLiveMicActive: Boolean = false,
    val liveMicDurationSec: Int = 0,
    val loginError: String? = null
)

class MainViewModel(application: Application) : AndroidViewModel(application) {
    private val prefs = AppPreferences(application)
    private val api = ApiClient(prefs)
    private val socketClient = SocketClient(api.json)
    private var mediaPlayer: MediaPlayer? = null

    private var voiceRecorder: MediaRecorder? = null
    private var voiceRecordTimerJob: Job? = null
    private var voicePreviewJob: Job? = null
    private var chimeTrack: AudioTrack? = null

    private var liveMicSessionId: String? = null
    private var liveMicStreamJob: Job? = null
    private var liveMicTimerJob: Job? = null
    private var liveAudioRecord: AudioRecord? = null

    var uiState by mutableStateOf(MainUiState(serverUrl = prefs.serverUrl))
        private set

    var snackbarMessage by mutableStateOf<String?>(null)
        private set

    init {
        restoreSession()
    }

    fun consumeSnackbar() {
        snackbarMessage = null
    }

    private fun showMessage(msg: String) {
        snackbarMessage = msg
    }

    fun updateServerUrlDraft(newUrl: String) {
        uiState = uiState.copy(serverUrl = newUrl)
    }

    fun restoreSession() {
        val token = prefs.authToken
        if (token.isNullOrBlank()) {
            uiState = uiState.copy(initializing = false, user = null)
            return
        }
        viewModelScope.launch {
            try {
                val me = api.me()
                uiState = uiState.copy(initializing = false, user = me.user, loginError = null)
                connectSocket(token)
                refreshAll()
            } catch (err: ApiException) {
                if (err.statusCode == 401) {
                    prefs.authToken = null
                    uiState = uiState.copy(initializing = false, user = null)
                } else {
                    uiState = uiState.copy(initializing = false, loginError = err.message)
                }
            } catch (err: Exception) {
                uiState = uiState.copy(
                    initializing = false,
                    loginError = err.message ?: "Gagal menghubungi server"
                )
            }
        }
    }

    fun login(serverUrl: String, username: String, password: String) {
        if (username.isBlank() || password.isBlank()) {
            uiState = uiState.copy(loginError = "Username dan password wajib diisi")
            return
        }
        val normalized = AppPreferences.normalizeUrl(serverUrl)
        prefs.serverUrl = normalized
        uiState = uiState.copy(serverUrl = normalized, isBusy = true, loginError = null)

        viewModelScope.launch {
            try {
                val res = api.login(username, password)
                prefs.authToken = res.token
                uiState = uiState.copy(isBusy = false, user = res.user, loginError = null)
                connectSocket(res.token)
                refreshAll()
            } catch (err: Exception) {
                uiState = uiState.copy(
                    isBusy = false,
                    loginError = err.message ?: "Gagal login ke server"
                )
            }
        }
    }

    fun logout() {
        stopLiveMic()
        stopVoiceNoteRecording(keepFile = false)
        stopPhoneAudio()
        socketClient.disconnect()
        prefs.authToken = null
        uiState = MainUiState(initializing = false, serverUrl = prefs.serverUrl, user = null)
    }

    private fun connectSocket(token: String) {
        socketClient.connect(
            serverUrl = prefs.serverUrl,
            token = token,
            onConnectionChanged = { connected ->
                viewModelScope.launch(Dispatchers.Main) {
                    uiState = uiState.copy(socketConnected = connected)
                }
            },
            onScheduleUpdated = { snapshot ->
                viewModelScope.launch(Dispatchers.Main) {
                    uiState = uiState.copy(snapshot = snapshot)
                }
            },
            onDeviceStatus = { status ->
                viewModelScope.launch(Dispatchers.Main) {
                    uiState = uiState.copy(deviceStatus = status)
                }
            },
            onAudioManifestUpdated = { files ->
                viewModelScope.launch(Dispatchers.Main) {
                    uiState = uiState.copy(localAudioFiles = files)
                }
            },
            onServerAudioUpdated = { files ->
                viewModelScope.launch(Dispatchers.Main) {
                    uiState = uiState.copy(serverAudioFiles = files)
                }
            },
            onLogsUpdated = { logs ->
                viewModelScope.launch(Dispatchers.Main) {
                    uiState = uiState.copy(logs = logs)
                }
            }
        )
    }

    fun refreshAll() {
        val currentUser = uiState.user ?: return
        viewModelScope.launch {
            uiState = uiState.copy(isRefreshing = true)
            try {
                val snapRes = api.getSnapshot()
                val statusRes = api.getDeviceStatus()
                val serverAudioRes = api.listServerAudio()
                uiState = uiState.copy(
                    snapshot = snapRes.snapshot,
                    deviceStatus = statusRes.status,
                    localAudioFiles = statusRes.audioFiles,
                    logs = statusRes.logs,
                    serverAudioFiles = serverAudioRes.files
                )
                if (currentUser.role == "admin") {
                    runCatching {
                        val usersRes = api.listUsers()
                        val tokenRes = api.getDeviceToken()
                        val backupsRes = api.listBackups()
                        uiState = uiState.copy(
                            users = usersRes.users,
                            deviceToken = tokenRes.deviceToken,
                            backupSettings = backupsRes.settings,
                            backupFiles = backupsRes.files
                        )
                    }
                }
            } catch (err: Exception) {
                showMessage(err.message ?: "Gagal memuat data dari server")
            } finally {
                uiState = uiState.copy(isRefreshing = false)
            }
        }
    }

    private fun runMutation(
        successMessage: String? = null,
        block: suspend () -> Unit
    ) {
        viewModelScope.launch {
            uiState = uiState.copy(isBusy = true)
            try {
                block()
                if (successMessage != null) {
                    showMessage(successMessage)
                }
            } catch (err: Exception) {
                showMessage(err.message ?: "Operasi gagal")
            } finally {
                uiState = uiState.copy(isBusy = false)
            }
        }
    }

    // --- Remote Controls ---
    fun playManual(label: String, steps: List<AudioStep>) {
        runMutation("Perintah bunyikan '$label' dikirim ke PC Bel") {
            api.playManual(label, steps)
        }
    }

    fun playSingleFileAtBell(fileName: String, label: String) {
        val steps = listOf(
            AudioStep(
                id = java.util.UUID.randomUUID().toString(),
                fileName = fileName,
                delayBeforeMs = 0,
                volume = 100
            )
        )
        playManual(label, steps)
    }

    fun stopBellAudio() {
        runMutation("Perintah hentikan audio dikirim") {
            api.stopAudio()
        }
    }

    fun syncBellNow() {
        runMutation("Perintah sinkronisasi dikirim ke PC Bel") {
            api.syncNow()
        }
    }

    fun remoteShutdown(action: String, graceSeconds: Int, reason: String) {
        val actionLabel = if (action == "restart") "Restart" else "Shutdown"
        runMutation("Perintah $actionLabel PC Bel dikirim") {
            api.remoteShutdown(action, graceSeconds, reason)
        }
    }

    fun cancelShutdown() {
        runMutation("Permintaan pembatalan shutdown dikirim") {
            api.cancelShutdown()
        }
    }

    // --- Phone Audio Preview (with OFF button) ---
    fun playPhoneAudioPreview(fileName: String) {
        stopPhoneAudio()
        uiState = uiState.copy(previewingFileName = fileName)
        viewModelScope.launch {
            try {
                val safeName = fileName.substringAfterLast("/")
                val bytes = api.downloadBytes("/api/audio/server-files/${java.net.URLEncoder.encode(safeName, "UTF-8").replace("+", "%20")}/stream")
                val cacheFile = File(getApplication<Application>().cacheDir, "preview_audio.tmp")
                withContext(Dispatchers.IO) {
                    cacheFile.writeBytes(bytes)
                }
                val mp = MediaPlayer()
                mp.setDataSource(cacheFile.absolutePath)
                mp.setOnCompletionListener {
                    stopPhoneAudio()
                }
                mp.setOnErrorListener { _, _, _ ->
                    stopPhoneAudio()
                    showMessage("Gagal memutar pratinjau audio di HP")
                    true
                }
                mp.prepare()
                mp.start()
                mediaPlayer = mp
            } catch (err: Exception) {
                stopPhoneAudio()
                showMessage(err.message ?: "Gagal memutar pratinjau")
            }
        }
    }

    fun stopPhoneAudio() {
        runCatching {
            mediaPlayer?.stop()
        }
        runCatching {
            mediaPlayer?.release()
        }
        mediaPlayer = null
        uiState = uiState.copy(previewingFileName = null)
    }

    // --- Quick Today Override & Calendar ---
    fun applyTodayOverride(profileId: String?, note: String) {
        runMutation("Jadwal hari ini diperbarui") {
            val res = api.upsertTodayOverride(TodayOverrideRequest(profileId = profileId, note = note))
            uiState = uiState.copy(snapshot = res.snapshot)
        }
    }

    fun removeOverride(id: String) {
        runMutation("Pengecualian tanggal dihapus") {
            val res = api.deleteOverride(id)
            uiState = uiState.copy(snapshot = res.snapshot)
        }
    }

    fun saveWeeklyRules(rules: List<WeeklyRuleInput>) {
        runMutation("Aturan mingguan disimpan") {
            val res = api.updateWeeklyRules(rules)
            uiState = uiState.copy(snapshot = res.snapshot)
        }
    }

    fun createOverride(startDate: String, endDate: String, profileId: String?, note: String) {
        runMutation("Pengecualian tanggal ditambahkan") {
            val res = api.createOverride(
                DateOverrideCreateRequest(
                    startDate = startDate,
                    endDate = endDate,
                    profileId = profileId,
                    note = note
                )
            )
            uiState = uiState.copy(snapshot = res.snapshot)
        }
    }

    // --- Profiles ---
    fun saveProfile(existingId: String?, req: ProfileUpsertRequest) {
        runMutation(if (existingId == null) "Profil jadwal dibuat" else "Profil jadwal diperbarui") {
            val res = if (existingId == null) {
                api.createProfile(req)
            } else {
                api.updateProfile(existingId, req)
            }
            uiState = uiState.copy(snapshot = res.snapshot)
        }
    }

    fun duplicateProfile(id: String) {
        runMutation("Profil diduplikat") {
            val res = api.duplicateProfile(id)
            uiState = uiState.copy(snapshot = res.snapshot)
        }
    }

    fun shiftProfile(id: String, deltaMinutes: Int) {
        runMutation("Jam slot digeser $deltaMinutes menit") {
            val res = api.shiftProfile(id, deltaMinutes)
            uiState = uiState.copy(snapshot = res.snapshot)
        }
    }

    fun deleteProfile(id: String) {
        runMutation("Profil dihapus") {
            val res = api.deleteProfile(id)
            uiState = uiState.copy(snapshot = res.snapshot)
        }
    }

    fun generateSlots(
        startTime: String,
        lessonCount: Int,
        lessonDurationMinutes: Int,
        introFileName: String?,
        introDelayMs: Int?,
        lessonFilePattern: String?,
        endOfDayLabel: String?,
        endOfDayFileName: String?,
        breaks: List<GenerateScheduleBreak>,
        onGenerated: (List<ScheduleSlot>) -> Unit
    ) {
        runMutation("Slot jadwal otomatis berhasil dibuat") {
            val res = api.generatePreview(
                startTime,
                lessonCount,
                lessonDurationMinutes,
                introFileName,
                introDelayMs,
                lessonFilePattern,
                endOfDayLabel,
                endOfDayFileName,
                breaks
            )
            onGenerated(res.slots)
        }
    }

    // --- Audio Upload / Delete ---
    fun uploadAudioUri(uri: Uri) {
        viewModelScope.launch {
            uiState = uiState.copy(isBusy = true)
            try {
                val ctx = getApplication<Application>()
                val resolver = ctx.contentResolver
                val fileName = resolver.query(uri, null, null, null, null)?.use { cursor ->
                    val nameIdx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    if (cursor.moveToFirst() && nameIdx >= 0) cursor.getString(nameIdx) else null
                } ?: "audio_${System.currentTimeMillis()}.mp3"
                val mime = resolver.getType(uri) ?: "audio/mpeg"
                val bytes = withContext(Dispatchers.IO) {
                    resolver.openInputStream(uri)?.use { it.readBytes() }
                        ?: throw IllegalStateException("Tidak dapat membaca file yang dipilih")
                }
                val res = api.uploadServerAudio(fileName, mime, bytes)
                uiState = uiState.copy(serverAudioFiles = res.files)
                showMessage("Berhasil mengunggah ${res.file.fileName}")
            } catch (err: Exception) {
                showMessage(err.message ?: "Gagal mengunggah audio")
            } finally {
                uiState = uiState.copy(isBusy = false)
            }
        }
    }

    fun deleteServerAudio(fileName: String) {
        runMutation("Audio server dihapus") {
            val res = api.deleteServerAudio(fileName)
            uiState = uiState.copy(serverAudioFiles = res.files)
        }
    }

    // --- Settings, Users, Backups ---
    fun saveShutdownSettings(enabled: Boolean, graceSeconds: Int, dayRules: List<ShutdownDayRule>) {
        runMutation("Pengaturan auto-shutdown disimpan") {
            val res = api.updateShutdownSettings(
                ShutdownSettingsUpdateRequest(enabled, graceSeconds, dayRules)
            )
            uiState = uiState.copy(snapshot = res.snapshot)
        }
    }

    fun changePassword(currentPassword: String, newPassword: String, onDone: () -> Unit) {
        runMutation("Password berhasil diubah") {
            val res = api.changePassword(currentPassword, newPassword)
            uiState = uiState.copy(user = res.user)
            onDone()
        }
    }

    fun createUser(username: String, displayName: String, role: String, password: String, onDone: () -> Unit) {
        runMutation("User '$username' dibuat") {
            api.createUser(CreateUserRequest(username, displayName, role, password))
            val list = api.listUsers()
            uiState = uiState.copy(users = list.users)
            onDone()
        }
    }

    fun updateUser(
        id: String,
        displayName: String? = null,
        role: String? = null,
        active: Boolean? = null,
        password: String? = null
    ) {
        runMutation("Data user diperbarui") {
            api.updateUser(id, displayName, role, active, password)
            val list = api.listUsers()
            uiState = uiState.copy(users = list.users)
        }
    }

    fun deleteUser(id: String) {
        runMutation("User dihapus") {
            api.deleteUser(id)
            val list = api.listUsers()
            uiState = uiState.copy(users = list.users)
        }
    }

    fun rotateDeviceToken() {
        runMutation("Device token diperbarui") {
            val res = api.rotateDeviceToken()
            uiState = uiState.copy(deviceToken = res.deviceToken)
        }
    }

    fun saveBackupSettings(enabled: Boolean, time: String, retainCount: Int) {
        runMutation("Pengaturan auto-backup disimpan") {
            val res = api.updateBackupSettings(BackupSettingsRequest(enabled, time, retainCount))
            uiState = uiState.copy(backupSettings = res.settings)
        }
    }

    fun createBackupNow() {
        runMutation("Backup database berhasil dibuat") {
            val res = api.createBackup()
            uiState = uiState.copy(backupSettings = res.settings, backupFiles = res.files)
        }
    }

    fun deleteBackup(fileName: String) {
        runMutation("File backup dihapus") {
            val res = api.deleteBackup(fileName)
            uiState = uiState.copy(backupFiles = res.files)
        }
    }

    fun exportScheduleJsonToUri(uri: Uri) {
        viewModelScope.launch {
            uiState = uiState.copy(isBusy = true)
            try {
                val bytes = api.downloadScheduleJson()
                withContext(Dispatchers.IO) {
                    getApplication<Application>().contentResolver.openOutputStream(uri)?.use {
                        it.write(bytes)
                    } ?: throw IllegalStateException("Gagal menulis file tujuan")
                }
                showMessage("Backup jadwal JSON berhasil disimpan")
            } catch (err: Exception) {
                showMessage(err.message ?: "Gagal export jadwal JSON")
            } finally {
                uiState = uiState.copy(isBusy = false)
            }
        }
    }

    fun exportDbBackupToUri(fileName: String, uri: Uri) {
        viewModelScope.launch {
            uiState = uiState.copy(isBusy = true)
            try {
                val bytes = api.downloadBackupBytes(fileName)
                withContext(Dispatchers.IO) {
                    getApplication<Application>().contentResolver.openOutputStream(uri)?.use {
                        it.write(bytes)
                    } ?: throw IllegalStateException("Gagal menulis file backup")
                }
                showMessage("File $fileName berhasil diunduh")
            } catch (err: Exception) {
                showMessage(err.message ?: "Gagal mengunduh file backup")
            } finally {
                uiState = uiState.copy(isBusy = false)
            }
        }
    }

    fun restoreScheduleFromUri(uri: Uri) {
        viewModelScope.launch {
            uiState = uiState.copy(isBusy = true)
            try {
                val rawText = withContext(Dispatchers.IO) {
                    getApplication<Application>().contentResolver.openInputStream(uri)?.use {
                        it.bufferedReader().readText()
                    } ?: throw IllegalStateException("Tidak dapat membaca file JSON")
                }
                val res = api.restoreScheduleJson(rawText)
                uiState = uiState.copy(snapshot = res.snapshot, backupFiles = res.files)
                showMessage("Jadwal berhasil di-restore dari file JSON")
            } catch (err: Exception) {
                showMessage(err.message ?: "Gagal restore file JSON")
            } finally {
                uiState = uiState.copy(isBusy = false)
            }
        }
    }

    override fun onCleared() {
        stopLiveMic()
        stopVoiceNoteRecording(keepFile = false)
        stopPhoneAudio()
        socketClient.disconnect()
        super.onCleared()
    }

    // --- Pengumuman: Ting-Tong, Mode 1 Voice Note + Preview, Mode 2 Live Mic ---
    private fun voiceNoteDraftFile(): File =
        File(getApplication<Application>().cacheDir, "voice_note_draft.m4a")

    fun playChimeOnly() {
        runMutation("Nada Ting-Tong dibunyikan di PC Bel") {
            api.playChime()
        }
    }

    fun startVoiceNoteRecording() {
        stopPhoneAudio()
        stopLiveMic()
        stopVoiceNoteRecording(keepFile = false)

        val ctx = getApplication<Application>()
        val draftFile = voiceNoteDraftFile()
        runCatching { draftFile.delete() }

        try {
            val recorder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                MediaRecorder(ctx)
            } else {
                @Suppress("DEPRECATION")
                MediaRecorder()
            }
            recorder.setAudioSource(MediaRecorder.AudioSource.MIC)
            recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            recorder.setAudioSamplingRate(44100)
            recorder.setAudioEncodingBitRate(96000)
            recorder.setOutputFile(draftFile.absolutePath)
            recorder.prepare()
            recorder.start()
            voiceRecorder = recorder

            uiState = uiState.copy(
                isRecordingVoiceNote = true,
                voiceNoteDurationSec = 0,
                hasRecordedVoiceNote = false
            )
            voiceRecordTimerJob?.cancel()
            voiceRecordTimerJob = viewModelScope.launch {
                while (isActive) {
                    delay(1000)
                    uiState = uiState.copy(voiceNoteDurationSec = uiState.voiceNoteDurationSec + 1)
                }
            }
        } catch (err: Exception) {
            stopVoiceNoteRecording(keepFile = false)
            showMessage(err.message ?: "Gagal memulai perekaman suara")
        }
    }

    fun stopVoiceNoteRecording(keepFile: Boolean = true) {
        voiceRecordTimerJob?.cancel()
        voiceRecordTimerJob = null
        val rec = voiceRecorder
        voiceRecorder = null
        if (rec != null) {
            runCatching { rec.stop() }
            runCatching { rec.release() }
        }
        val fileExists = keepFile && voiceNoteDraftFile().let { it.exists() && it.length() > 0 }
        uiState = uiState.copy(
            isRecordingVoiceNote = false,
            hasRecordedVoiceNote = fileExists
        )
    }

    fun discardVoiceNoteRecording() {
        stopVoiceNotePreview()
        stopVoiceNoteRecording(keepFile = false)
        runCatching { voiceNoteDraftFile().delete() }
        uiState = uiState.copy(hasRecordedVoiceNote = false, voiceNoteDurationSec = 0)
    }

    fun previewVoiceNote(withChime: Boolean) {
        val draftFile = voiceNoteDraftFile()
        if (!draftFile.exists() || draftFile.length() == 0L) {
            showMessage("Rekaman belum tersedia")
            return
        }
        stopPhoneAudio()
        stopVoiceNotePreview()

        uiState = uiState.copy(isPreviewingVoiceNote = true)
        voicePreviewJob = viewModelScope.launch {
            try {
                if (withChime) {
                    playLocalChimeInPhone()
                }
                if (!isActive) return@launch
                val mp = MediaPlayer()
                mp.setDataSource(draftFile.absolutePath)
                mp.setOnCompletionListener {
                    stopVoiceNotePreview()
                }
                mp.setOnErrorListener { _, _, _ ->
                    stopVoiceNotePreview()
                    showMessage("Gagal memutar pratinjau rekaman")
                    true
                }
                mp.prepare()
                mp.start()
                mediaPlayer = mp
            } catch (err: Exception) {
                stopVoiceNotePreview()
                showMessage(err.message ?: "Gagal memutar pratinjau")
            }
        }
    }

    fun stopVoiceNotePreview() {
        voicePreviewJob?.cancel()
        voicePreviewJob = null
        runCatching { chimeTrack?.stop() }
        runCatching { chimeTrack?.release() }
        chimeTrack = null
        runCatching { mediaPlayer?.stop() }
        runCatching { mediaPlayer?.release() }
        mediaPlayer = null
        uiState = uiState.copy(isPreviewingVoiceNote = false)
    }

    private suspend fun playLocalChimeInPhone() = withContext(Dispatchers.IO) {
        val sampleRate = 22050
        val totalSamples = (sampleRate * 1.15).toInt()
        val pcm = ShortArray(totalSamples)
        for (i in 0 until totalSamples) {
            val t = i.toDouble() / sampleRate
            var sample = 0.0
            if (t >= 0.01 && t < 0.50) {
                val nt = t - 0.01
                val env = exp(-nt * 6.0)
                sample += (sin(2.0 * PI * 784.0 * nt) + 0.22 * sin(2.0 * PI * 1568.0 * nt)) * env
            }
            if (t >= 0.40) {
                val nt = t - 0.40
                val env = exp(-nt * 4.2)
                sample += (sin(2.0 * PI * 523.25 * nt) + 0.22 * sin(2.0 * PI * 1046.5 * nt)) * env
            }
            val scaled = (sample * 18000.0).toInt().coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt())
            pcm[i] = scaled.toShort()
        }

        val track = AudioTrack.Builder()
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                    .build()
            )
            .setAudioFormat(
                AudioFormat.Builder()
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setSampleRate(sampleRate)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                    .build()
            )
            .setBufferSizeInBytes(pcm.size * 2)
            .setTransferMode(AudioTrack.MODE_STATIC)
            .build()

        chimeTrack = track
        track.write(pcm, 0, pcm.size)
        track.play()
        delay(1150)
        runCatching { track.stop() }
        runCatching { track.release() }
        if (chimeTrack === track) chimeTrack = null
    }

    fun sendVoiceNoteToBell(withChime: Boolean, label: String) {
        val draftFile = voiceNoteDraftFile()
        if (!draftFile.exists() || draftFile.length() == 0L) {
            showMessage("Rekam suara terlebih dahulu")
            return
        }
        stopVoiceNotePreview()
        viewModelScope.launch {
            uiState = uiState.copy(isBusy = true)
            try {
                val bytes = withContext(Dispatchers.IO) { draftFile.readBytes() }
                api.uploadVoiceNoteAnnouncement(
                    fileName = "pengumuman.m4a",
                    mimeType = "audio/mp4",
                    bytes = bytes,
                    withChime = withChime,
                    label = label.ifBlank { "Pengumuman Langsung" }
                )
                showMessage("Pengumuman suara dikirim ke PC Bel!")
            } catch (err: Exception) {
                showMessage(err.message ?: "Gagal mengirim pengumuman suara")
            } finally {
                uiState = uiState.copy(isBusy = false)
            }
        }
    }

    @SuppressLint("MissingPermission")
    fun startLiveMic(withChime: Boolean) {
        if (uiState.isLiveMicActive) return
        stopVoiceNotePreview()
        stopVoiceNoteRecording(keepFile = false)

        val sampleRate = 16000
        uiState = uiState.copy(isBusy = true)
        socketClient.startLiveMic(withChime, sampleRate) { ok, res ->
            viewModelScope.launch(Dispatchers.Main) {
                uiState = uiState.copy(isBusy = false)
                if (!ok || res.isBlank()) {
                    showMessage(res.ifBlank { "Gagal memulai Live Mic" })
                    return@launch
                }

                val sessionId = res
                liveMicSessionId = sessionId
                val minBuf = AudioRecord.getMinBufferSize(
                    sampleRate,
                    AudioFormat.CHANNEL_IN_MONO,
                    AudioFormat.ENCODING_PCM_16BIT
                )
                val bufSize = maxOf(minBuf, 4096)
                val recorder = AudioRecord(
                    MediaRecorder.AudioSource.MIC,
                    sampleRate,
                    AudioFormat.CHANNEL_IN_MONO,
                    AudioFormat.ENCODING_PCM_16BIT,
                    bufSize
                )
                if (recorder.state != AudioRecord.STATE_INITIALIZED) {
                    runCatching { recorder.release() }
                    socketClient.stopLiveMic(sessionId)
                    liveMicSessionId = null
                    showMessage("Mikrofon HP gagal diinisialisasi")
                    return@launch
                }

                liveAudioRecord = recorder
                uiState = uiState.copy(isLiveMicActive = true, liveMicDurationSec = 0)

                liveMicTimerJob?.cancel()
                liveMicTimerJob = viewModelScope.launch {
                    while (isActive) {
                        delay(1000)
                        uiState = uiState.copy(liveMicDurationSec = uiState.liveMicDurationSec + 1)
                    }
                }

                liveMicStreamJob?.cancel()
                liveMicStreamJob = viewModelScope.launch(Dispatchers.IO) {
                    val chunkBytes = ByteArray(3200) // ~100ms at 16kHz 16-bit mono
                    runCatching { recorder.startRecording() }
                    try {
                        while (isActive && liveMicSessionId == sessionId) {
                            val read = recorder.read(chunkBytes, 0, chunkBytes.size)
                            if (read > 0) {
                                val slice = if (read == chunkBytes.size) chunkBytes else chunkBytes.copyOf(read)
                                val b64 = Base64.encodeToString(slice, Base64.NO_WRAP)
                                socketClient.sendLiveMicChunk(sessionId, b64, sampleRate)
                            } else {
                                delay(20)
                            }
                        }
                    } finally {
                        runCatching { recorder.stop() }
                        runCatching { recorder.release() }
                    }
                }
            }
        }
    }

    fun stopLiveMic() {
        liveMicTimerJob?.cancel()
        liveMicTimerJob = null
        val sid = liveMicSessionId
        liveMicSessionId = null
        liveMicStreamJob?.cancel()
        liveMicStreamJob = null
        runCatching { liveAudioRecord?.stop() }
        runCatching { liveAudioRecord?.release() }
        liveAudioRecord = null
        if (sid != null) {
            socketClient.stopLiveMic(sid)
            showMessage("Siaran Live Mic selesai")
        }
        uiState = uiState.copy(isLiveMicActive = false, liveMicDurationSec = 0)
    }
}
