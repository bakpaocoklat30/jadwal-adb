package id.sch.smkn1adw.beladb.ui.screens

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import id.sch.smkn1adw.beladb.ui.MainUiState
import id.sch.smkn1adw.beladb.ui.components.SectionCard
import id.sch.smkn1adw.beladb.ui.components.StatusPill
import id.sch.smkn1adw.beladb.ui.theme.*
import java.util.Locale

private fun formatDurationSec(sec: Int): String {
    val m = sec / 60
    val s = sec % 60
    return String.format(Locale.US, "%02d:%02d", m, s)
}

@Composable
fun AnnounceScreen(
    state: MainUiState,
    onPlayChimeOnly: () -> Unit,
    onStopBellAudio: () -> Unit,
    onStartVoiceRecord: () -> Unit,
    onStopVoiceRecord: () -> Unit,
    onDiscardVoiceRecord: () -> Unit,
    onPreviewVoiceRecord: (withChime: Boolean) -> Unit,
    onStopVoicePreview: () -> Unit,
    onSendVoiceNoteToBell: (withChime: Boolean, label: String) -> Unit,
    onStartLiveMic: (withChime: Boolean) -> Unit,
    onStopLiveMic: () -> Unit
) {
    val context = LocalContext.current
    var selectedMode by remember { mutableIntStateOf(0) } // 0 = Voice Note, 1 = Live Mic
    var voiceWithChime by remember { mutableStateOf(true) }
    var voiceLabel by remember { mutableStateOf("Pengumuman Langsung") }
    var liveWithChime by remember { mutableStateOf(true) }
    var pendingMicAction by remember { mutableStateOf<(() -> Unit)?>(null) }

    val permissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission()
    ) { granted ->
        val action = pendingMicAction
        pendingMicAction = null
        if (granted && action != null) {
            action()
        }
    }

    fun runWithMicPermission(action: () -> Unit) {
        val granted = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.RECORD_AUDIO
        ) == PackageManager.PERMISSION_GRANTED
        if (granted) {
            action()
        } else {
            pendingMicAction = action
            permissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(SlateBg)
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        // Top Card: Status PC Bel + Standalone Ting-Tong Button
        SectionCard(
            title = "Pengumuman Langsung",
            subtitle = if (state.deviceStatus.online) {
                "Terhubung ke ${state.deviceStatus.deviceName}"
            } else {
                "PC Bel sedang offline — pengumuman tidak dapat dikirim"
            },
            trailing = {
                StatusPill(
                    text = if (state.deviceStatus.online) "SIAP" else "OFFLINE",
                    containerColor = if (state.deviceStatus.online) EmeraldContainer else RedContainer,
                    contentColor = if (state.deviceStatus.online) EmeraldAccent else RedDanger
                )
            }
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Button(
                    onClick = onPlayChimeOnly,
                    enabled = state.deviceStatus.online && !state.isBusy && !state.isLiveMicActive,
                    modifier = Modifier.weight(1f),
                    colors = ButtonDefaults.buttonColors(containerColor = NavyPrimary)
                ) {
                    Icon(Icons.Default.Notifications, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(modifier = Modifier.width(6.dp))
                    Text("Ting-Tong! (PC Bel)")
                }

                if (state.deviceStatus.isPlaying && !state.isLiveMicActive) {
                    Button(
                        onClick = onStopBellAudio,
                        colors = ButtonDefaults.buttonColors(containerColor = RedDanger)
                    ) {
                        Icon(Icons.Default.Stop, contentDescription = null, modifier = Modifier.size(18.dp))
                        Spacer(modifier = Modifier.width(4.dp))
                        Text("Stop")
                    }
                }
            }
        }

        // Mode Switcher
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            FilterChip(
                selected = selectedMode == 0,
                onClick = {
                    if (!state.isLiveMicActive) selectedMode = 0
                },
                enabled = !state.isLiveMicActive,
                label = { Text("Mode 1: Voice Note") },
                leadingIcon = {
                    Icon(Icons.Default.MusicNote, contentDescription = null, modifier = Modifier.size(18.dp))
                },
                modifier = Modifier.weight(1f)
            )
            FilterChip(
                selected = selectedMode == 1,
                onClick = {
                    if (!state.isRecordingVoiceNote) selectedMode = 1
                },
                enabled = !state.isRecordingVoiceNote,
                label = { Text("Mode 2: Live Mic") },
                leadingIcon = {
                    Icon(Icons.Default.Mic, contentDescription = null, modifier = Modifier.size(18.dp))
                },
                modifier = Modifier.weight(1f)
            )
        }

        if (selectedMode == 0) {
            // MODE 1: VOICE NOTE + TING-TONG + PREVIEW
            SectionCard(
                title = "Voice Note Pengumuman",
                subtitle = "Rekam suara dulu, cek pratinjau di HP, lalu bunyikan jernih di speaker sekolah"
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text("Awali dengan Nada Ting-Tong", fontWeight = FontWeight.Medium)
                        Text(
                            "Bunyi bel pembuka sebelum suara pengumuman",
                            style = MaterialTheme.typography.bodySmall,
                            color = SlateMuted
                        )
                    }
                    Switch(
                        checked = voiceWithChime,
                        onCheckedChange = { voiceWithChime = it },
                        enabled = !state.isRecordingVoiceNote && !state.isPreviewingVoiceNote
                    )
                }

                Spacer(modifier = Modifier.height(10.dp))

                OutlinedTextField(
                    value = voiceLabel,
                    onValueChange = { voiceLabel = it },
                    label = { Text("Keterangan di Riwayat Log") },
                    singleLine = true,
                    enabled = !state.isRecordingVoiceNote,
                    modifier = Modifier.fillMaxWidth()
                )

                Spacer(modifier = Modifier.height(18.dp))

                // Record Button & Timer
                Column(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Surface(
                        onClick = {
                            if (state.isRecordingVoiceNote) {
                                onStopVoiceRecord()
                            } else {
                                runWithMicPermission { onStartVoiceRecord() }
                            }
                        },
                        enabled = !state.isBusy,
                        shape = CircleShape,
                        color = if (state.isRecordingVoiceNote) RedDanger else NavyPrimary,
                        modifier = Modifier.size(84.dp)
                    ) {
                        Box(contentAlignment = Alignment.Center) {
                            Icon(
                                imageVector = if (state.isRecordingVoiceNote) Icons.Default.Stop else Icons.Default.Mic,
                                contentDescription = if (state.isRecordingVoiceNote) "Hentikan Rekam" else "Mulai Rekam",
                                tint = Color.White,
                                modifier = Modifier.size(38.dp)
                            )
                        }
                    }

                    Spacer(modifier = Modifier.height(10.dp))
                    Text(
                        text = if (state.isRecordingVoiceNote) {
                            "Merekam... ${formatDurationSec(state.voiceNoteDurationSec)}"
                        } else if (state.hasRecordedVoiceNote) {
                            "Rekaman siap (${formatDurationSec(state.voiceNoteDurationSec)})"
                        } else {
                            "Ketuk mikrofon untuk mulai merekam"
                        },
                        fontWeight = FontWeight.SemiBold,
                        color = if (state.isRecordingVoiceNote) RedDanger else SlateText
                    )
                }

                if (state.hasRecordedVoiceNote && !state.isRecordingVoiceNote) {
                    Spacer(modifier = Modifier.height(18.dp))
                    HorizontalDivider()
                    Spacer(modifier = Modifier.height(12.dp))

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        OutlinedButton(
                            onClick = {
                                if (state.isPreviewingVoiceNote) onStopVoicePreview()
                                else onPreviewVoiceRecord(voiceWithChime)
                            },
                            enabled = !state.isBusy,
                            modifier = Modifier.weight(1f),
                            colors = if (state.isPreviewingVoiceNote) {
                                ButtonDefaults.outlinedButtonColors(contentColor = RedDanger)
                            } else {
                                ButtonDefaults.outlinedButtonColors()
                            }
                        ) {
                            Icon(
                                imageVector = if (state.isPreviewingVoiceNote) Icons.Default.Stop else Icons.Default.VolumeUp,
                                contentDescription = null,
                                modifier = Modifier.size(18.dp)
                            )
                            Spacer(modifier = Modifier.width(6.dp))
                            Text(if (state.isPreviewingVoiceNote) "OFF Preview" else "Preview di HP")
                        }

                        OutlinedButton(
                            onClick = onDiscardVoiceRecord,
                            enabled = !state.isBusy && !state.isPreviewingVoiceNote,
                            colors = ButtonDefaults.outlinedButtonColors(contentColor = RedDanger)
                        ) {
                            Icon(Icons.Default.Delete, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(modifier = Modifier.width(4.dp))
                            Text("Hapus")
                        }
                    }

                    Spacer(modifier = Modifier.height(10.dp))

                    Button(
                        onClick = { onSendVoiceNoteToBell(voiceWithChime, voiceLabel) },
                        enabled = state.deviceStatus.online && !state.isBusy,
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(48.dp),
                        shape = RoundedCornerShape(12.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = EmeraldAccent)
                    ) {
                        Icon(Icons.Default.PlayArrow, contentDescription = null, modifier = Modifier.size(20.dp))
                        Spacer(modifier = Modifier.width(6.dp))
                        Text("Kirim & Bunyikan di PC Bel")
                    }
                }
            }
        } else {
            // MODE 2: LIVE MIC STREAMING REALTIME
            SectionCard(
                title = "Live Mic (Walkie-Talkie Real-Time)",
                subtitle = "Suara langsung disiarkan ke speaker PC Bel saat Anda berbicara"
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text("Bunyikan Ting-Tong saat Mulai", fontWeight = FontWeight.Medium)
                        Text(
                            "Putar bel pembuka sesaat sebelum suara mic masuk",
                            style = MaterialTheme.typography.bodySmall,
                            color = SlateMuted
                        )
                    }
                    Switch(
                        checked = liveWithChime,
                        onCheckedChange = { liveWithChime = it },
                        enabled = !state.isLiveMicActive
                    )
                }

                Spacer(modifier = Modifier.height(12.dp))

                Surface(
                    color = AmberContainer,
                    shape = RoundedCornerShape(10.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(
                        text = "Tip: Hindari berdiri terlalu dekat dengan speaker sekolah saat Live Mic aktif agar tidak terjadi suara mendengung (feedback).",
                        style = MaterialTheme.typography.bodySmall,
                        color = SlateText,
                        modifier = Modifier.padding(10.dp)
                    )
                }

                Spacer(modifier = Modifier.height(20.dp))

                Column(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    if (state.isLiveMicActive) {
                        StatusPill(
                            text = "SEDANG SIARAN LANGSUNG • ${formatDurationSec(state.liveMicDurationSec)}",
                            containerColor = RedContainer,
                            contentColor = RedDanger
                        )
                        Spacer(modifier = Modifier.height(14.dp))
                    }

                    Surface(
                        onClick = {
                            if (state.isLiveMicActive) {
                                onStopLiveMic()
                            } else {
                                runWithMicPermission { onStartLiveMic(liveWithChime) }
                            }
                        },
                        enabled = state.isLiveMicActive || (state.deviceStatus.online && state.socketConnected && !state.isBusy),
                        shape = CircleShape,
                        color = when {
                            state.isLiveMicActive -> RedDanger
                            state.deviceStatus.online && state.socketConnected -> EmeraldAccent
                            else -> SlateMuted
                        },
                        modifier = Modifier.size(96.dp)
                    ) {
                        Box(contentAlignment = Alignment.Center) {
                            Icon(
                                imageVector = if (state.isLiveMicActive) Icons.Default.Stop else Icons.Default.Mic,
                                contentDescription = if (state.isLiveMicActive) "Hentikan Live Mic" else "Mulai Live Mic",
                                tint = Color.White,
                                modifier = Modifier.size(44.dp)
                            )
                        }
                    }

                    Spacer(modifier = Modifier.height(10.dp))
                    Text(
                        text = when {
                            state.isLiveMicActive -> "Ketuk tombol merah untuk mengakhiri siaran"
                            !state.deviceStatus.online -> "PC Bel offline — tidak dapat Live Mic"
                            !state.socketConnected -> "Menunggu koneksi real-time ke server..."
                            else -> "Ketuk untuk mulai siaran langsung"
                        },
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.Medium,
                        color = if (state.isLiveMicActive) RedDanger else SlateText
                    )
                }
            }
        }
    }
}
