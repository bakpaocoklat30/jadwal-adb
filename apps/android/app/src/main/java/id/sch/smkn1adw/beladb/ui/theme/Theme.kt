package id.sch.smkn1adw.beladb.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

val NavyPrimary = Color(0xFF1E3A8A)
val NavyContainer = Color(0xFFDBEAFE)
val EmeraldAccent = Color(0xFF059669)
val EmeraldContainer = Color(0xFFD1FAE5)
val AmberWarn = Color(0xFFD97706)
val AmberContainer = Color(0xFFFEF3C7)
val RedDanger = Color(0xFFDC2626)
val RedContainer = Color(0xFFFEE2E2)
val SlateBg = Color(0xFFF8FAFC)
val SlateCard = Color(0xFFFFFFFF)
val SlateBorder = Color(0xFFE2E8F0)
val SlateText = Color(0xFF0F172A)
val SlateMuted = Color(0xFF64748B)

private val AppColorScheme = lightColorScheme(
    primary = NavyPrimary,
    onPrimary = Color.White,
    primaryContainer = NavyContainer,
    onPrimaryContainer = Color(0xFF1E293B),
    secondary = EmeraldAccent,
    onSecondary = Color.White,
    secondaryContainer = EmeraldContainer,
    onSecondaryContainer = Color(0xFF064E3B),
    error = RedDanger,
    onError = Color.White,
    errorContainer = RedContainer,
    onErrorContainer = Color(0xFF7F1D1D),
    background = SlateBg,
    onBackground = SlateText,
    surface = SlateCard,
    onSurface = SlateText,
    surfaceVariant = Color(0xFFF1F5F9),
    onSurfaceVariant = SlateMuted,
    outline = SlateBorder
)

@Composable
fun BelSekolahADBTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = AppColorScheme,
        content = content
    )
}
