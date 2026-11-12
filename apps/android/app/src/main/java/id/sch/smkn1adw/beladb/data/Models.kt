package id.sch.smkn1adw.beladb.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.TimeZone

val DAY_NAMES_ID = listOf(
    "Minggu",
    "Senin",
    "Selasa",
    "Rabu",
    "Kamis",
    "Jumat",
    "Sabtu"
)

@Serializable
data class UserPublic(
    val id: String,
    val username: String,
    val displayName: String,
    val role: String, // "admin" | "waka" | "piket"
    val active: Boolean = true,
    val mustChangePassword: Boolean = false,
    val createdAt: String = "",
    val updatedAt: String = ""
)

@Serializable
data class AudioStep(
    val id: String,
    val fileName: String,
    val delayBeforeMs: Int = 0,
    val volume: Int = 100
)

@Serializable
data class ScheduleSlot(
    val id: String,
    val time: String, // HH:MM
    val label: String,
    val enabled: Boolean = true,
    val steps: List<AudioStep> = emptyList()
)

@Serializable
data class ScheduleProfile(
    val id: String,
    val name: String,
    val description: String = "",
    val color: String = "#2563eb",
    val slots: List<ScheduleSlot> = emptyList(),
    val createdAt: String = "",
    val updatedAt: String = ""
)

@Serializable
data class WeeklyRule(
    val dayOfWeek: Int, // 0 = Minggu .. 6 = Sabtu
    val profileId: String? = null,
    val updatedAt: String = ""
)

@Serializable
data class WeeklyRuleInput(
    val dayOfWeek: Int,
    val profileId: String? = null
)

@Serializable
data class DateOverride(
    val id: String,
    val startDate: String, // YYYY-MM-DD
    val endDate: String, // YYYY-MM-DD
    val profileId: String? = null,
    val note: String,
    val createdBy: String = "",
    val createdAt: String = ""
)

@Serializable
data class ShutdownDayRule(
    val dayOfWeek: Int,
    val enabled: Boolean,
    val time: String
)

@Serializable
data class ShutdownSettings(
    val enabled: Boolean = false,
    val graceSeconds: Int = 20,
    val dayRules: List<ShutdownDayRule> = defaultShutdownDayRules(),
    val updatedAt: String = ""
)

fun defaultShutdownDayRules(): List<ShutdownDayRule> {
    val defaultTimes = mapOf(
        0 to "12:00",
        1 to "16:30",
        2 to "16:30",
        3 to "16:30",
        4 to "16:30",
        5 to "12:30",
        6 to "13:00"
    )
    return (0..6).map { day ->
        ShutdownDayRule(
            dayOfWeek = day,
            enabled = day in 1..5,
            time = defaultTimes[day] ?: "16:30"
        )
    }
}

@Serializable
data class BackupSettings(
    val enabled: Boolean = true,
    val time: String = "02:00",
    val retainCount: Int = 14,
    val lastBackupAt: String? = null,
    val updatedAt: String = ""
)

@Serializable
data class BackupFileInfo(
    val fileName: String,
    val sizeBytes: Long,
    val createdAt: String,
    val kind: String // "auto" | "manual"
)

@Serializable
data class ScheduleSnapshot(
    val version: Int = 0,
    val schoolName: String = "SMK Negeri 1 Adiwerna",
    val timeZone: String = "Asia/Jakarta",
    val profiles: List<ScheduleProfile> = emptyList(),
    val weeklyRules: List<WeeklyRule> = emptyList(),
    val dateOverrides: List<DateOverride> = emptyList(),
    val shutdownSettings: ShutdownSettings = ShutdownSettings(),
    val generatedAt: String = ""
)

@Serializable
data class AudioFileEntry(
    val fileName: String,
    val relativePath: String,
    val sizeBytes: Long = 0,
    val updatedAt: String = ""
)

@Serializable
data class ServerAudioFile(
    val id: String,
    val fileName: String,
    val relativePath: String,
    val sizeBytes: Long = 0,
    val sha256: String = "",
    val uploadedBy: String = "",
    val uploadedAt: String = ""
)

@Serializable
data class DeviceStatus(
    val online: Boolean = false,
    val deviceName: String = "PC Bel Sekolah",
    val platform: String = "",
    val appVersion: String = "",
    val audioDir: String = "",
    val audioCount: Int = 0,
    val activeScheduleVersion: Int = 0,
    val lastHeartbeatAt: String? = null,
    val lastSyncAt: String? = null,
    val clockDriftMs: Long = 0,
    val isPlaying: Boolean = false,
    val currentPlayingLabel: String? = null,
    val shutdownState: String = "idle", // "idle" | "pending" | "shutting_down"
    val shutdownAction: String? = null,
    val shutdownRemainingSec: Int? = null,
    val shutdownReason: String? = null,
    val lastShutdownReason: String? = null,
    val lastShutdownAt: String? = null
)

@Serializable
data class BellLog(
    val id: String,
    val occurredAt: String,
    val triggerType: String,
    val status: String,
    val profileName: String? = null,
    val slotLabel: String,
    val scheduledTime: String? = null,
    val files: List<String> = emptyList(),
    val actorName: String? = null,
    val detail: String? = null
)

@Serializable
data class GenerateScheduleBreak(
    val afterLesson: Int,
    val durationMinutes: Int,
    val label: String,
    val fileName: String
)

@Serializable
data class GenerateScheduleRequest(
    val startTime: String,
    val lessonCount: Int,
    val lessonDurationMinutes: Int,
    val introFileName: String? = null,
    val introDelayMs: Int? = null,
    val lessonFilePattern: String? = null,
    val endOfDayLabel: String? = null,
    val endOfDayFileName: String? = null,
    val breaks: List<GenerateScheduleBreak> = emptyList()
)

// API DTOs
@Serializable
data class LoginRequest(val username: String, val password: String)

@Serializable
data class LoginResponse(val token: String, val user: UserPublic)

@Serializable
data class MeResponse(val user: UserPublic)

@Serializable
data class ChangePasswordRequest(val currentPassword: String, val newPassword: String)

@Serializable
data class UsersResponse(val users: List<UserPublic>)

@Serializable
data class UserResponse(val user: UserPublic)

@Serializable
data class CreateUserRequest(
    val username: String,
    val displayName: String,
    val role: String,
    val password: String
)

@Serializable
data class UpdateUserRequest(
    val displayName: String? = null,
    val role: String? = null,
    val active: Boolean? = null,
    val password: String? = null
)

@Serializable
data class SnapshotResponse(
    val snapshot: ScheduleSnapshot,
    val serverNowMs: Long = 0
)

@Serializable
data class SnapshotOnlyResponse(
    val snapshot: ScheduleSnapshot
)

@Serializable
data class DeviceStatusResponse(
    val status: DeviceStatus,
    val audioFiles: List<AudioFileEntry> = emptyList(),
    val logs: List<BellLog> = emptyList(),
    val serverNowMs: Long = 0
)

@Serializable
data class LogsResponse(val logs: List<BellLog> = emptyList())

@Serializable
data class DeviceTokenResponse(val deviceToken: String)

@Serializable
data class ProfileUpsertRequest(
    val name: String,
    val description: String,
    val color: String,
    val slots: List<ScheduleSlot>
)

@Serializable
data class ProfileMutationResponse(
    val profile: ScheduleProfile,
    val snapshot: ScheduleSnapshot
)

@Serializable
data class ShiftSlotsRequest(val deltaMinutes: Int)

@Serializable
data class GeneratePreviewResponse(val slots: List<ScheduleSlot>)

@Serializable
data class WeeklyRulesUpdateRequest(val rules: List<WeeklyRuleInput>)

@Serializable
data class WeeklyRulesResponse(
    val weeklyRules: List<WeeklyRule>,
    val snapshot: ScheduleSnapshot
)

@Serializable
data class DateOverrideCreateRequest(
    val startDate: String,
    val endDate: String,
    val profileId: String? = null,
    val note: String
)

@Serializable
data class TodayOverrideRequest(
    val date: String? = null,
    val profileId: String? = null,
    val note: String
)

@Serializable
data class OverrideMutationResponse(
    val override: DateOverride,
    val snapshot: ScheduleSnapshot
)

@Serializable
data class PlayManualRequest(
    val label: String,
    val steps: List<AudioStep>
)

@Serializable
data class RemoteShutdownRequest(
    val action: String,
    val graceSeconds: Int,
    val reason: String
)

@Serializable
data class ServerAudioFilesResponse(val files: List<ServerAudioFile> = emptyList())

@Serializable
data class ServerAudioUploadResponse(
    val file: ServerAudioFile,
    val files: List<ServerAudioFile> = emptyList()
)

@Serializable
data class ShutdownSettingsUpdateRequest(
    val enabled: Boolean,
    val graceSeconds: Int,
    val dayRules: List<ShutdownDayRule>
)

@Serializable
data class ShutdownSettingsResponse(
    val shutdownSettings: ShutdownSettings,
    val snapshot: ScheduleSnapshot
)

@Serializable
data class BackupsResponse(
    val settings: BackupSettings,
    val files: List<BackupFileInfo> = emptyList()
)

@Serializable
data class BackupSettingsRequest(
    val enabled: Boolean,
    val time: String,
    val retainCount: Int
)

@Serializable
data class BackupSettingsResponse(val settings: BackupSettings)

@Serializable
data class BackupCreateResponse(
    val file: BackupFileInfo,
    val settings: BackupSettings,
    val files: List<BackupFileInfo> = emptyList()
)

@Serializable
data class BackupFilesOnlyResponse(
    val ok: Boolean = true,
    val files: List<BackupFileInfo> = emptyList()
)

@Serializable
data class RestoreScheduleResponse(
    val snapshot: ScheduleSnapshot,
    val files: List<BackupFileInfo> = emptyList()
)

@Serializable
data class ErrorResponse(val error: String? = null)

@Serializable
data class RestorePayloadRaw(val json: JsonElement)

data class ResolvedDaySchedule(
    val dateStr: String,
    val dayOfWeek: Int,
    val source: String, // "override" | "weekly" | "none"
    val override: DateOverride? = null,
    val profile: ScheduleProfile? = null,
    val slots: List<ScheduleSlot> = emptyList()
)

object ScheduleResolver {
    fun getZonedTodayParts(timeZoneId: String): Triple<String, String, Int> {
        val tz = runCatching { TimeZone.getTimeZone(timeZoneId) }
            .getOrDefault(TimeZone.getTimeZone("Asia/Jakarta"))
        val now = Date()
        val cal = Calendar.getInstance(tz).apply { time = now }
        val dateFmt = SimpleDateFormat("yyyy-MM-dd", Locale.US).apply { timeZone = tz }
        val timeFmt = SimpleDateFormat("HH:mm", Locale.US).apply { timeZone = tz }
        // Calendar.SUNDAY = 1 .. SATURDAY = 7 -> convert to 0..6
        val dayOfWeek = (cal.get(Calendar.DAY_OF_WEEK) - 1).coerceIn(0, 6)
        return Triple(dateFmt.format(now), timeFmt.format(now), dayOfWeek)
    }

    fun resolveDay(snapshot: ScheduleSnapshot, dateStr: String, dayOfWeek: Int): ResolvedDaySchedule {
        val profileMap = snapshot.profiles.associateBy { it.id }
        val matchingOverrides = snapshot.dateOverrides.filter {
            it.startDate <= dateStr && dateStr <= it.endDate
        }.sortedWith(
            compareBy<DateOverride> { dateSpanDays(it.startDate, it.endDate) }
                .thenByDescending { it.createdAt }
        )

        val activeOverride = matchingOverrides.firstOrNull()
        if (activeOverride != null) {
            val profile = activeOverride.profileId?.let { profileMap[it] }
            return ResolvedDaySchedule(
                dateStr = dateStr,
                dayOfWeek = dayOfWeek,
                source = "override",
                override = activeOverride,
                profile = profile,
                slots = profile?.slots?.sortedBy { it.time } ?: emptyList()
            )
        }

        val weekly = snapshot.weeklyRules.firstOrNull { it.dayOfWeek == dayOfWeek }
        if (weekly != null) {
            val profile = weekly.profileId?.let { profileMap[it] }
            return ResolvedDaySchedule(
                dateStr = dateStr,
                dayOfWeek = dayOfWeek,
                source = "weekly",
                override = null,
                profile = profile,
                slots = profile?.slots?.sortedBy { it.time } ?: emptyList()
            )
        }

        return ResolvedDaySchedule(dateStr = dateStr, dayOfWeek = dayOfWeek, source = "none")
    }

    fun getNextSlot(resolved: ResolvedDaySchedule, currentTimeStr: String): ScheduleSlot? {
        return resolved.slots.firstOrNull { it.enabled && it.time > currentTimeStr }
    }

    private fun dateSpanDays(startDate: String, endDate: String): Long {
        return runCatching {
            val fmt = SimpleDateFormat("yyyy-MM-dd", Locale.US).apply {
                timeZone = TimeZone.getTimeZone("UTC")
            }
            val start = fmt.parse(startDate)?.time ?: 0L
            val end = fmt.parse(endDate)?.time ?: 0L
            ((end - start) / 86_400_000L).coerceAtLeast(0L)
        }.getOrDefault(0L)
    }
}

fun formatBytes(bytes: Long): String {
    if (bytes < 1024) return "$bytes B"
    val kb = bytes / 1024.0
    if (kb < 1024) return String.format(Locale.US, "%.1f KB", kb)
    val mb = kb / 1024.0
    return String.format(Locale.US, "%.1f MB", mb)
}

fun formatShortTime(iso: String?): String {
    if (iso.isNullOrBlank()) return "-"
    return runCatching {
        val inFmt = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US).apply {
            timeZone = TimeZone.getTimeZone("UTC")
        }
        val cleaned = iso.substringBefore(".").substringBefore("Z")
        val date = inFmt.parse(cleaned) ?: return iso
        val outFmt = SimpleDateFormat("dd/MM HH:mm:ss", Locale.US).apply {
            timeZone = TimeZone.getTimeZone("Asia/Jakarta")
        }
        outFmt.format(date)
    }.getOrDefault(iso.take(19))
}
