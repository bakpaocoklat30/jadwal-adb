package id.sch.smkn1adw.beladb.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.net.URLEncoder
import java.util.concurrent.TimeUnit

class ApiException(
    override val message: String,
    val statusCode: Int
) : Exception(message)

class ApiClient(private val prefs: AppPreferences) {
    val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
        isLenient = true
    }

    val httpClient: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(12, TimeUnit.SECONDS)
        .readTimeout(45, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        .build()

    private val jsonMediaType = "application/json; charset=utf-8".toMediaType()

    private fun baseUrl(): String = AppPreferences.normalizeUrl(prefs.serverUrl)

    private fun encodePathSegment(raw: String): String =
        URLEncoder.encode(raw, "UTF-8").replace("+", "%20")

    fun streamAudioUrl(fileName: String): String =
        "${baseUrl()}/api/audio/server-files/${encodePathSegment(fileName)}/stream"

    private suspend inline fun <reified T> request(
        method: String,
        path: String,
        bodyJson: String? = null,
        includeAuth: Boolean = true
    ): T = withContext(Dispatchers.IO) {
        val url = "${baseUrl()}$path"
        val reqBody: RequestBody? = when {
            bodyJson != null -> bodyJson.toRequestBody(jsonMediaType)
            method == "POST" || method == "PUT" || method == "PATCH" ->
                ByteArray(0).toRequestBody(null)
            else -> null
        }

        val builder = Request.Builder()
            .url(url)
            .method(method, reqBody)

        if (includeAuth) {
            val token = prefs.authToken
            if (!token.isNullOrBlank()) {
                builder.header("Authorization", "Bearer $token")
            }
        }

        httpClient.newCall(builder.build()).execute().use { response ->
            val rawText = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                val parsedError = runCatching {
                    json.decodeFromString<ErrorResponse>(rawText).error
                }.getOrNull()
                throw ApiException(
                    parsedError ?: "Permintaan gagal (${response.code})",
                    response.code
                )
            }
            json.decodeFromString<T>(rawText)
        }
    }

    private suspend fun requestUnit(
        method: String,
        path: String,
        bodyJson: String? = null
    ) {
        withContext(Dispatchers.IO) {
            val url = "${baseUrl()}$path"
            val reqBody: RequestBody? = when {
                bodyJson != null -> bodyJson.toRequestBody(jsonMediaType)
                method == "POST" || method == "PUT" || method == "PATCH" ->
                    ByteArray(0).toRequestBody(null)
                else -> null
            }
            val builder = Request.Builder()
                .url(url)
                .method(method, reqBody)
            prefs.authToken?.takeIf { it.isNotBlank() }?.let {
                builder.header("Authorization", "Bearer $it")
            }

            httpClient.newCall(builder.build()).execute().use { response ->
                val rawText = response.body?.string().orEmpty()
                if (!response.isSuccessful) {
                    val parsedError = runCatching {
                        json.decodeFromString<ErrorResponse>(rawText).error
                    }.getOrNull()
                    throw ApiException(
                        parsedError ?: "Permintaan gagal (${response.code})",
                        response.code
                    )
                }
            }
        }
    }

    suspend fun downloadBytes(path: String): ByteArray = withContext(Dispatchers.IO) {
        val builder = Request.Builder()
            .url("${baseUrl()}$path")
            .get()
        prefs.authToken?.takeIf { it.isNotBlank() }?.let {
            builder.header("Authorization", "Bearer $it")
        }
        httpClient.newCall(builder.build()).execute().use { response ->
            if (!response.isSuccessful) {
                val rawText = response.body?.string().orEmpty()
                val parsedError = runCatching {
                    json.decodeFromString<ErrorResponse>(rawText).error
                }.getOrNull()
                throw ApiException(
                    parsedError ?: "Gagal mengunduh (${response.code})",
                    response.code
                )
            }
            response.body?.bytes() ?: ByteArray(0)
        }
    }

    // --- Auth & Users ---
    suspend fun login(username: String, password: String): LoginResponse =
        request(
            "POST",
            "/api/auth/login",
            json.encodeToString(LoginRequest(username.trim(), password)),
            includeAuth = false
        )

    suspend fun me(): MeResponse = request("GET", "/api/auth/me")

    suspend fun changePassword(currentPassword: String, newPassword: String): UserResponse =
        request(
            "POST",
            "/api/auth/change-password",
            json.encodeToString(ChangePasswordRequest(currentPassword, newPassword))
        )

    suspend fun listUsers(): UsersResponse = request("GET", "/api/users")

    suspend fun createUser(req: CreateUserRequest): UserResponse =
        request("POST", "/api/users", json.encodeToString(req))

    suspend fun updateUser(
        id: String,
        displayName: String? = null,
        role: String? = null,
        active: Boolean? = null,
        password: String? = null
    ): UserResponse {
        val obj: JsonObject = buildJsonObject {
            displayName?.let { put("displayName", it) }
            role?.let { put("role", it) }
            active?.let { put("active", it) }
            password?.takeIf { it.isNotEmpty() }?.let { put("password", it) }
        }
        return request("PATCH", "/api/users/$id", obj.toString())
    }

    suspend fun deleteUser(id: String) = requestUnit("DELETE", "/api/users/$id")

    // --- Device, Logs, Settings ---
    suspend fun getDeviceStatus(): DeviceStatusResponse = request("GET", "/api/device/status")

    suspend fun listLogs(limit: Int = 100): LogsResponse =
        request("GET", "/api/logs?limit=$limit")

    suspend fun getDeviceToken(): DeviceTokenResponse = request("GET", "/api/device/token")

    suspend fun rotateDeviceToken(): DeviceTokenResponse =
        request("POST", "/api/device/token/rotate")

    suspend fun updateShutdownSettings(req: ShutdownSettingsUpdateRequest): ShutdownSettingsResponse =
        request("PUT", "/api/settings/shutdown", json.encodeToString(req))

    // --- Schedule & Profiles ---
    suspend fun getSnapshot(): SnapshotResponse = request("GET", "/api/schedule/snapshot")

    suspend fun createProfile(req: ProfileUpsertRequest): ProfileMutationResponse =
        request("POST", "/api/profiles", json.encodeToString(req))

    suspend fun updateProfile(id: String, req: ProfileUpsertRequest): ProfileMutationResponse =
        request("PUT", "/api/profiles/$id", json.encodeToString(req))

    suspend fun duplicateProfile(id: String): ProfileMutationResponse =
        request("POST", "/api/profiles/$id/duplicate")

    suspend fun shiftProfile(id: String, deltaMinutes: Int): ProfileMutationResponse =
        request("POST", "/api/profiles/$id/shift", json.encodeToString(ShiftSlotsRequest(deltaMinutes)))

    suspend fun generatePreview(
        startTime: String,
        lessonCount: Int,
        lessonDurationMinutes: Int,
        introFileName: String?,
        introDelayMs: Int?,
        lessonFilePattern: String?,
        endOfDayLabel: String?,
        endOfDayFileName: String?,
        breaks: List<GenerateScheduleBreak>
    ): GeneratePreviewResponse {
        val obj = buildJsonObject {
            put("startTime", startTime)
            put("lessonCount", lessonCount)
            put("lessonDurationMinutes", lessonDurationMinutes)
            introFileName?.takeIf { it.isNotBlank() }?.let { put("introFileName", it) }
            introDelayMs?.let { put("introDelayMs", it) }
            lessonFilePattern?.takeIf { it.isNotBlank() }?.let { put("lessonFilePattern", it) }
            endOfDayLabel?.takeIf { it.isNotBlank() }?.let { put("endOfDayLabel", it) }
            endOfDayFileName?.takeIf { it.isNotBlank() }?.let { put("endOfDayFileName", it) }
            put("breaks", json.encodeToJsonElement(
                kotlinx.serialization.builtins.ListSerializer(GenerateScheduleBreak.serializer()),
                breaks
            ))
        }
        return request("POST", "/api/profiles/generate-preview", obj.toString())
    }

    suspend fun deleteProfile(id: String): SnapshotOnlyResponse =
        request("DELETE", "/api/profiles/$id")

    suspend fun updateWeeklyRules(rules: List<WeeklyRuleInput>): WeeklyRulesResponse =
        request("PUT", "/api/weekly-rules", json.encodeToString(WeeklyRulesUpdateRequest(rules)))

    suspend fun createOverride(req: DateOverrideCreateRequest): OverrideMutationResponse =
        request("POST", "/api/overrides", json.encodeToString(req))

    suspend fun upsertTodayOverride(req: TodayOverrideRequest): OverrideMutationResponse =
        request("POST", "/api/overrides/today", json.encodeToString(req))

    suspend fun deleteOverride(id: String): SnapshotOnlyResponse =
        request("DELETE", "/api/overrides/$id")

    // --- Remote Control ---
    suspend fun playManual(label: String, steps: List<AudioStep>) =
        requestUnit("POST", "/api/remote/play-manual", json.encodeToString(PlayManualRequest(label, steps)))

    suspend fun stopAudio() = requestUnit("POST", "/api/remote/stop-audio")

    suspend fun syncNow() = requestUnit("POST", "/api/remote/sync-now")

    suspend fun remoteShutdown(action: String, graceSeconds: Int, reason: String) =
        requestUnit(
            "POST",
            "/api/remote/shutdown",
            json.encodeToString(RemoteShutdownRequest(action, graceSeconds, reason))
        )

    suspend fun cancelShutdown() = requestUnit("POST", "/api/remote/cancel-shutdown")

    suspend fun playChime() = requestUnit("POST", "/api/remote/play-chime")

    suspend fun uploadVoiceNoteAnnouncement(
        fileName: String,
        mimeType: String,
        bytes: ByteArray,
        withChime: Boolean,
        label: String
    ) = withContext(Dispatchers.IO) {
        val body = MultipartBody.Builder()
            .setType(MultipartBody.FORM)
            .addFormDataPart(
                "file",
                fileName,
                bytes.toRequestBody(mimeType.toMediaType())
            )
            .build()

        val encodedLabel = URLEncoder.encode(label.ifBlank { "Pengumuman Langsung" }, "UTF-8")
        val builder = Request.Builder()
            .url("${baseUrl()}/api/remote/announce-voice-note?withChime=$withChime&label=$encodedLabel")
            .post(body)
        prefs.authToken?.takeIf { it.isNotBlank() }?.let {
            builder.header("Authorization", "Bearer $it")
        }

        httpClient.newCall(builder.build()).execute().use { response ->
            val rawText = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                val parsedError = runCatching {
                    json.decodeFromString<ErrorResponse>(rawText).error
                }.getOrNull()
                throw ApiException(
                    parsedError ?: "Gagal mengirim pengumuman (${response.code})",
                    response.code
                )
            }
        }
    }

    // --- Audio ---
    suspend fun listServerAudio(): ServerAudioFilesResponse =
        request("GET", "/api/audio/server-files")

    suspend fun uploadServerAudio(
        fileName: String,
        mimeType: String,
        bytes: ByteArray
    ): ServerAudioUploadResponse = withContext(Dispatchers.IO) {
        val body = MultipartBody.Builder()
            .setType(MultipartBody.FORM)
            .addFormDataPart(
                "file",
                fileName,
                bytes.toRequestBody(mimeType.toMediaType())
            )
            .build()

        val builder = Request.Builder()
            .url("${baseUrl()}/api/audio/upload")
            .post(body)
        prefs.authToken?.takeIf { it.isNotBlank() }?.let {
            builder.header("Authorization", "Bearer $it")
        }

        httpClient.newCall(builder.build()).execute().use { response ->
            val rawText = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                val parsedError = runCatching {
                    json.decodeFromString<ErrorResponse>(rawText).error
                }.getOrNull()
                throw ApiException(
                    parsedError ?: "Upload gagal (${response.code})",
                    response.code
                )
            }
            json.decodeFromString(rawText)
        }
    }

    suspend fun deleteServerAudio(fileName: String): ServerAudioFilesResponse =
        request("DELETE", "/api/audio/server-files/${encodePathSegment(fileName)}")

    // --- Backups ---
    suspend fun listBackups(): BackupsResponse = request("GET", "/api/backups")

    suspend fun updateBackupSettings(req: BackupSettingsRequest): BackupSettingsResponse =
        request("PUT", "/api/backups/settings", json.encodeToString(req))

    suspend fun createBackup(): BackupCreateResponse = request("POST", "/api/backups/create")

    suspend fun downloadBackupBytes(fileName: String): ByteArray =
        downloadBytes("/api/backups/${encodePathSegment(fileName)}/download")

    suspend fun deleteBackup(fileName: String): BackupFilesOnlyResponse =
        request("DELETE", "/api/backups/${encodePathSegment(fileName)}")

    suspend fun downloadScheduleJson(): ByteArray =
        downloadBytes("/api/backups/schedule-json")

    suspend fun restoreScheduleJson(rawJson: String): RestoreScheduleResponse =
        request("POST", "/api/backups/restore-schedule", rawJson)
}
