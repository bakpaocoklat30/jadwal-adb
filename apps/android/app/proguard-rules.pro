# Keep kotlinx.serialization classes
-keepattributes *Annotation*, InnerClasses, Signature
-dontnote kotlinx.serialization.AnnotationsKt

-keepclassmembers class kotlinx.serialization.json.** {
    *** Companion;
}
-keepclasseswithmembers class kotlinx.serialization.json.** {
    kotlinx.serialization.KSerializer serializer(...);
}
-keep,includedescriptorclasses class id.sch.smkn1adw.beladb.data.**$$serializer { *; }
-keepclassmembers class id.sch.smkn1adw.beladb.data.** {
    *** Companion;
}
-keepclasseswithmembers class id.sch.smkn1adw.beladb.data.** {
    kotlinx.serialization.KSerializer serializer(...);
}

# Keep Socket.IO & OkHttp
-keep class io.socket.** { *; }
-dontwarn io.socket.**
-keep class okhttp3.** { *; }
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**
