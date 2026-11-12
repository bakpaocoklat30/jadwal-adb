package id.sch.smkn1adw.beladb.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import id.sch.smkn1adw.beladb.data.formatBytes
import id.sch.smkn1adw.beladb.ui.MainUiState
import id.sch.smkn1adw.beladb.ui.components.SectionCard
import id.sch.smkn1adw.beladb.ui.theme.*

@Composable
fun AudioScreen(
    state: MainUiState,
    canDeleteServerAudio: Boolean,
    onPickUploadAudio: () -> Unit,
    onPlayAtBell: (fileName: String, label: String) -> Unit,
    onStopBellAudio: () -> Unit,
    onPreviewInPhone: (fileName: String) -> Unit,
    onStopPhonePreview: () -> Unit,
    onDeleteServerAudio: (fileName: String) -> Unit
) {
    var selectedTab by remember { mutableIntStateOf(0) } // 0 = Server Upload, 1 = PC Bel Lokal
    var searchQuery by remember { mutableStateOf("") }

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .background(SlateBg),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        // Active phone preview audio OFF bar
        if (state.previewingFileName != null) {
            item {
                Card(
                    colors = CardDefaults.cardColors(containerColor = NavyContainer),
                    shape = RoundedCornerShape(14.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = "Sedang Memutar Pratinjau di HP",
                                style = MaterialTheme.typography.labelMedium,
                                fontWeight = FontWeight.Bold,
                                color = NavyPrimary
                            )
                            Text(state.previewingFileName, style = MaterialTheme.typography.bodySmall)
                        }
                        Button(
                            onClick = onStopPhonePreview,
                            colors = ButtonDefaults.buttonColors(containerColor = RedDanger)
                        ) {
                            Icon(Icons.Default.Stop, contentDescription = null, modifier = Modifier.size(16.dp))
                            Spacer(modifier = Modifier.width(4.dp))
                            Text("OFF")
                        }
                    }
                }
            }
        }

        // PC Bel playing banner + Stop
        if (state.deviceStatus.isPlaying) {
            item {
                Card(
                    colors = CardDefaults.cardColors(containerColor = EmeraldContainer),
                    shape = RoundedCornerShape(14.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = "PC Bel Sedang Berbunyi",
                                style = MaterialTheme.typography.labelMedium,
                                fontWeight = FontWeight.Bold,
                                color = EmeraldAccent
                            )
                            Text(state.deviceStatus.currentPlayingLabel ?: "Audio")
                        }
                        Button(
                            onClick = onStopBellAudio,
                            colors = ButtonDefaults.buttonColors(containerColor = RedDanger)
                        ) {
                            Icon(Icons.Default.Stop, contentDescription = null, modifier = Modifier.size(16.dp))
                            Spacer(modifier = Modifier.width(4.dp))
                            Text("Stop Bel")
                        }
                    }
                }
            }
        }

        // Upload & Tab switcher
        item {
            SectionCard(
                title = "Pustaka Audio & Putar Manual",
                subtitle = "Putar audio langsung ke speaker PC Bel atau unggah MP3 baru dari HP",
                trailing = {
                    Button(
                        onClick = onPickUploadAudio,
                        enabled = !state.isBusy
                    ) {
                        Icon(Icons.Default.CloudUpload, contentDescription = null, modifier = Modifier.size(18.dp))
                        Spacer(modifier = Modifier.width(6.dp))
                        Text("Upload MP3")
                    }
                }
            ) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(
                        selected = selectedTab == 0,
                        onClick = { selectedTab = 0 },
                        label = { Text("Upload Server (${state.serverAudioFiles.size})") }
                    )
                    FilterChip(
                        selected = selectedTab == 1,
                        onClick = { selectedTab = 1 },
                        label = { Text("Lokal PC Bel (${state.localAudioFiles.size})") }
                    )
                }

                Spacer(modifier = Modifier.height(10.dp))

                OutlinedTextField(
                    value = searchQuery,
                    onValueChange = { searchQuery = it },
                    label = { Text("Cari nama file audio...") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
            }
        }

        if (selectedTab == 0) {
            val filtered = state.serverAudioFiles.filter {
                it.fileName.contains(searchQuery, ignoreCase = true)
            }
            if (filtered.isEmpty()) {
                item {
                    SectionCard {
                        Text(
                            text = "Belum ada audio yang diunggah ke server.",
                            style = MaterialTheme.typography.bodySmall,
                            color = SlateMuted
                        )
                    }
                }
            } else {
                items(filtered, key = { it.id }) { file ->
                    Card(
                        shape = RoundedCornerShape(14.dp),
                        colors = CardDefaults.cardColors(containerColor = SlateCard),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Column(modifier = Modifier.padding(14.dp)) {
                            Text(file.fileName, fontWeight = FontWeight.SemiBold)
                            Text(
                                text = "${formatBytes(file.sizeBytes)} • oleh ${file.uploadedBy}",
                                style = MaterialTheme.typography.bodySmall,
                                color = SlateMuted
                            )
                            Spacer(modifier = Modifier.height(8.dp))
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Button(
                                    onClick = {
                                        onPlayAtBell("_web/${file.fileName}", "Manual: ${file.fileName}")
                                    },
                                    enabled = state.deviceStatus.online && !state.isBusy,
                                    contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp)
                                ) {
                                    Icon(Icons.Default.PlayArrow, contentDescription = null, modifier = Modifier.size(16.dp))
                                    Spacer(modifier = Modifier.width(4.dp))
                                    Text("Putar di PC Bel")
                                }
                                val isThisPreviewing = state.previewingFileName == file.fileName
                                OutlinedButton(
                                    onClick = {
                                        if (isThisPreviewing) onStopPhonePreview()
                                        else onPreviewInPhone(file.fileName)
                                    },
                                    contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp)
                                ) {
                                    Icon(
                                        if (isThisPreviewing) Icons.Default.Stop else Icons.Default.VolumeUp,
                                        contentDescription = null,
                                        modifier = Modifier.size(16.dp)
                                    )
                                    Spacer(modifier = Modifier.width(4.dp))
                                    Text(if (isThisPreviewing) "OFF" else "Tes di HP")
                                }
                                if (canDeleteServerAudio) {
                                    IconButton(onClick = { onDeleteServerAudio(file.fileName) }) {
                                        Icon(Icons.Default.Delete, contentDescription = "Hapus", tint = RedDanger)
                                    }
                                }
                            }
                        }
                    }
                }
            }
        } else {
            val filtered = state.localAudioFiles.filter {
                it.relativePath.contains(searchQuery, ignoreCase = true)
            }
            if (filtered.isEmpty()) {
                item {
                    SectionCard {
                        Text(
                            text = "Daftar audio lokal PC Bel kosong atau PC Bel belum sinkron.",
                            style = MaterialTheme.typography.bodySmall,
                            color = SlateMuted
                        )
                    }
                }
            } else {
                items(filtered, key = { it.relativePath }) { file ->
                    Card(
                        shape = RoundedCornerShape(14.dp),
                        colors = CardDefaults.cardColors(containerColor = SlateCard),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(14.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Column(modifier = Modifier.weight(1f)) {
                                Text(file.relativePath, fontWeight = FontWeight.Medium)
                                Text(
                                    text = formatBytes(file.sizeBytes),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = SlateMuted
                                )
                            }
                            FilledTonalButton(
                                onClick = {
                                    onPlayAtBell(file.relativePath, "Manual: ${file.fileName}")
                                },
                                enabled = state.deviceStatus.online && !state.isBusy
                            ) {
                                Icon(Icons.Default.PlayArrow, contentDescription = null, modifier = Modifier.size(16.dp))
                                Spacer(modifier = Modifier.width(4.dp))
                                Text("Bunyikan")
                            }
                        }
                    }
                }
            }
        }
    }
}
