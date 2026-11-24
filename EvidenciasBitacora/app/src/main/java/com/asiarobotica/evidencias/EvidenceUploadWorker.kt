package com.asiarobotica.evidencias

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import android.webkit.MimeTypeMap
import androidx.core.app.NotificationCompat
import androidx.work.CoroutineWorker
import androidx.work.Data
import androidx.work.ForegroundInfo
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.abedelazizshe.lightcompressorlibrary.CompressionListener
import com.abedelazizshe.lightcompressorlibrary.VideoCompressor
import com.abedelazizshe.lightcompressorlibrary.VideoQuality
import com.abedelazizshe.lightcompressorlibrary.config.AppSpecificStorageConfiguration
import com.abedelazizshe.lightcompressorlibrary.config.Configuration
import com.google.gson.Gson
import com.google.gson.JsonObject
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlin.coroutines.coroutineContext
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

class EvidenceUploadWorker(
    appContext: Context,
    params: WorkerParameters
) : CoroutineWorker(appContext, params) {

    private data class DestinoDrive(val token: String, val carpetaId: String)

    private data class ArchivoPreparado(
        val archivo: File,
        val mime: String,
        val extension: String,
        val fueComprimido: Boolean = true
    )

    private val clienteHttp = OkHttpClient.Builder()
        .connectTimeout(60, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.MINUTES)
        .readTimeout(2, TimeUnit.MINUTES)
        .build()

    private val gson = Gson()
    private val mutexEstado = Mutex()
    private val progresoActual = AtomicInteger(0)
    @Volatile private var totalActual = 0

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val jobId = inputData.getString(KEY_JOB_ID) ?: return@withContext Result.failure()
        val job = UploadJobStore.cargar(applicationContext, jobId)
            ?: return@withContext Result.failure(errorData("No se encontró la cola de archivos."))

        val total = job.archivos.size
        var completados = job.archivos.count { it.completado }
        progresoActual.set(completados)
        totalActual = total
        setForeground(crearForegroundInfo(completados, total, "Preparando la carga…"))
        publicarProgreso(completados, total, "Preparando conexión con Drive…")

        try {
            val destino = prepararDestino(job.numeroSerie, job.categoria, job.numeroSerieExterno)
            val pendientes = job.archivos.filterNot { it.completado }
            val contador = AtomicInteger(completados)
            val semaforoImagenes = Semaphore(2)
            val semaforoSubidas = Semaphore(3)
            val mutexVideo = Mutex()

            coroutineScope {
                pendientes.map { item ->
                    async {
                        coroutineContext.ensureActive()
                        procesarArchivo(
                            job = job,
                            item = item,
                            destino = destino,
                            semaforoImagenes = semaforoImagenes,
                            semaforoSubidas = semaforoSubidas,
                            mutexVideo = mutexVideo
                        )

                        val avance = contador.incrementAndGet()
                        publicarProgreso(avance, total, "Procesados: $avance de $total")
                    }
                }.awaitAll()
            }

            completados = job.archivos.count { it.completado }
            val fallidos = total - completados
            val originales = job.archivos.count { it.completado && it.subidoSinComprimir }

            if (fallidos > 0) {
                setForeground(crearForegroundInfo(completados, total, "$fallidos archivo(s) pendientes"))
                return@withContext if (runAttemptCount < MAX_REINTENTOS) {
                    Result.retry()
                } else {
                    Result.failure(resultadoData(completados, total, originales, fallidos))
                }
            }

            setForeground(crearForegroundInfo(total, total, "Evidencias subidas correctamente"))
            Result.success(resultadoData(total, total, originales, 0))
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: Exception) {
            setForeground(crearForegroundInfo(completados, total, "La carga se reintentará"))
            if (runAttemptCount < MAX_REINTENTOS) {
                Result.retry()
            } else {
                Result.failure(errorData(error.message ?: "Error durante la carga"))
            }
        }
    }

    private suspend fun procesarArchivo(
        job: UploadJob,
        item: UploadJobItem,
        destino: DestinoDrive,
        semaforoImagenes: Semaphore,
        semaforoSubidas: Semaphore,
        mutexVideo: Mutex
    ) {
        val uri = Uri.parse(item.uri)
        val tipoMime = applicationContext.contentResolver.getType(uri) ?: "image/jpeg"
        val nombreBase = "${job.categoria}_${job.numeroSerie}_${item.indice}"
        var temporal: File? = null

        try {
            val preparado = if (tipoMime.startsWith("video/")) {
                mutexVideo.withLock {
                    publicarMensaje("Comprimiendo video $nombreBase…")
                    try {
                        ArchivoPreparado(comprimirVideo(uri), "video/mp4", "mp4")
                    } catch (cancelled: CancellationException) {
                        throw cancelled
                    } catch (_: Exception) {
                        prepararOriginal(uri, tipoMime)
                    }
                }
            } else {
                semaforoImagenes.withPermit {
                    publicarMensaje("Comprimiendo fotos…")
                    try {
                        ArchivoPreparado(comprimirImagen(uri), "image/jpeg", "jpg")
                    } catch (_: Exception) {
                        prepararOriginal(uri, tipoMime)
                    }
                }
            }

            temporal = preparado.archivo
            val nombre = "$nombreBase.${preparado.extension}"
            semaforoSubidas.withPermit {
                subirADrive(preparado.archivo, nombre, preparado.mime, destino)
            }

            mutexEstado.withLock {
                item.completado = true
                item.subidoSinComprimir = !preparado.fueComprimido
                item.error = null
                UploadJobStore.guardar(applicationContext, job)
            }
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: Exception) {
            mutexEstado.withLock {
                item.error = error.message ?: "Error desconocido"
                UploadJobStore.guardar(applicationContext, job)
            }
        } finally {
            temporal?.delete()
        }
    }

    private fun prepararDestino(
        numeroSerie: String,
        categoria: String,
        numeroSerieExterno: String?
    ): DestinoDrive {
        val urlBuilder = BackendConfig.APPS_SCRIPT_URL.toHttpUrl().newBuilder()
            .addQueryParameter("accion", "preparar")
            .addQueryParameter("numSerie", numeroSerie)
            .addQueryParameter("categoria", categoria)
        if (!numeroSerieExterno.isNullOrBlank()) {
            urlBuilder.addQueryParameter("numSerieExterno", numeroSerieExterno)
        }
        val url = urlBuilder.build()

        val request = Request.Builder().url(url).build()
        val cuerpo = clienteHttp.newCall(request).execute().use { response ->
            if (!response.isSuccessful) throw Exception("Apps Script respondió ${response.code}")
            response.body?.string().orEmpty()
        }

        val json = gson.fromJson(cuerpo, JsonObject::class.java)
        if (json.get("exito")?.asBoolean != true) {
            throw Exception(json.get("mensaje")?.asString ?: "No se pudo preparar Drive")
        }

        if (!numeroSerieExterno.isNullOrBlank() &&
            json.get("numeroSerieExternoGuardado")?.asString != numeroSerieExterno
        ) {
            throw Exception("No se confirmó el número de serie externo en Bitácora.")
        }

        return DestinoDrive(
            token = json.get("token").asString,
            carpetaId = json.get("idCarpeta").asString
        )
    }

    private fun comprimirImagen(uri: Uri): File {
        val maxDim = 1024
        val opciones = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        val entradaDimensiones = applicationContext.contentResolver.openInputStream(uri)
            ?: throw Exception("No se pudo abrir la imagen")
        entradaDimensiones.use { BitmapFactory.decodeStream(it, null, opciones) }

        if (opciones.outWidth <= 0 || opciones.outHeight <= 0) {
            throw Exception("Formato de imagen no válido")
        }

        opciones.inSampleSize = 1
        while (
            opciones.outWidth / opciones.inSampleSize > maxDim + (maxDim / 2) ||
            opciones.outHeight / opciones.inSampleSize > maxDim + (maxDim / 2)
        ) {
            opciones.inSampleSize *= 2
        }
        opciones.inJustDecodeBounds = false

        val bitmap = applicationContext.contentResolver.openInputStream(uri)?.use {
            BitmapFactory.decodeStream(it, null, opciones)
        } ?: throw Exception("No se pudo decodificar la imagen")

        val rotacion = try {
            applicationContext.contentResolver.openInputStream(uri)?.use { entrada ->
                when (ExifInterface(entrada).getAttributeInt(
                    ExifInterface.TAG_ORIENTATION,
                    ExifInterface.ORIENTATION_NORMAL
                )) {
                    ExifInterface.ORIENTATION_ROTATE_90 -> 90f
                    ExifInterface.ORIENTATION_ROTATE_180 -> 180f
                    ExifInterface.ORIENTATION_ROTATE_270 -> 270f
                    else -> 0f
                }
            } ?: 0f
        } catch (_: Exception) {
            0f
        }

        val orientado = if (rotacion != 0f) {
            Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, Matrix().apply {
                postRotate(rotacion)
            }, true).also { if (it !== bitmap) bitmap.recycle() }
        } else {
            bitmap
        }

        val escala = minOf(1f, maxDim.toFloat() / maxOf(orientado.width, orientado.height))
        val ancho = (orientado.width * escala).toInt().coerceAtLeast(1)
        val alto = (orientado.height * escala).toInt().coerceAtLeast(1)
        val escalado = if (ancho != orientado.width || alto != orientado.height) {
            Bitmap.createScaledBitmap(orientado, ancho, alto, true).also {
                if (it !== orientado) orientado.recycle()
            }
        } else {
            orientado
        }

        val destino = File(applicationContext.cacheDir, "img_${System.nanoTime()}.jpg")
        var bitmapActual = escalado
        val objetivo = 512L * 1024L

        try {
            var calidad = 75
            guardarJpeg(bitmapActual, destino, calidad)
            while (destino.length() > objetivo && calidad > 25) {
                calidad -= 10
                guardarJpeg(bitmapActual, destino, calidad)
            }

            while (destino.length() > objetivo && minOf(bitmapActual.width, bitmapActual.height) > 480) {
                val reducido = Bitmap.createScaledBitmap(
                    bitmapActual,
                    (bitmapActual.width * 0.8f).toInt().coerceAtLeast(1),
                    (bitmapActual.height * 0.8f).toInt().coerceAtLeast(1),
                    true
                )
                if (reducido !== bitmapActual) bitmapActual.recycle()
                bitmapActual = reducido
                calidad = 65
                guardarJpeg(bitmapActual, destino, calidad)
                while (destino.length() > objetivo && calidad > 25) {
                    calidad -= 10
                    guardarJpeg(bitmapActual, destino, calidad)
                }
            }
            return destino
        } catch (error: Exception) {
            destino.delete()
            throw error
        } finally {
            bitmapActual.recycle()
        }
    }

    private fun guardarJpeg(bitmap: Bitmap, destino: File, calidad: Int) {
        FileOutputStream(destino).use { salida ->
            if (!bitmap.compress(Bitmap.CompressFormat.JPEG, calidad, salida)) {
                throw Exception("No se pudo comprimir la imagen")
            }
        }
    }

    private suspend fun comprimirVideo(uri: Uri): File = kotlinx.coroutines.suspendCancellableCoroutine { continuation ->
        try {
            val nombre = "vid_${System.nanoTime()}.mp4"
            VideoCompressor.start(
                context = applicationContext,
                uris = listOf(uri),
                isStreamable = false,
                appSpecificStorageConfiguration = AppSpecificStorageConfiguration("evidencias_videos"),
                configureWith = Configuration(
                    quality = VideoQuality.MEDIUM,
                    isMinBitrateCheckEnabled = true,
                    videoNames = listOf(nombre)
                ),
                listener = object : CompressionListener {
                    override fun onStart(index: Int) = Unit
                    override fun onSuccess(index: Int, size: Long, path: String?) {
                        if (!continuation.isActive) return
                        if (path != null) continuation.resume(File(path))
                        else continuation.resumeWithException(Exception("El compresor no devolvió el video"))
                    }

                    override fun onFailure(index: Int, failureMessage: String) {
                        if (continuation.isActive) {
                            continuation.resumeWithException(Exception(failureMessage))
                        }
                    }

                    override fun onProgress(index: Int, percent: Float) = Unit
                    override fun onCancelled(index: Int) {
                        if (continuation.isActive) continuation.cancel()
                    }
                }
            )
        } catch (error: Exception) {
            if (continuation.isActive) continuation.resumeWithException(error)
        }
    }

    private fun prepararOriginal(uri: Uri, mime: String): ArchivoPreparado {
        val extension = MimeTypeMap.getSingleton().getExtensionFromMimeType(mime)
            ?: obtenerNombre(uri).substringAfterLast('.', "bin")
        val destino = File(applicationContext.cacheDir, "original_${System.nanoTime()}")
        val entrada = applicationContext.contentResolver.openInputStream(uri)
            ?: throw Exception("No se pudo abrir el archivo original")
        entrada.use { origen ->
            FileOutputStream(destino).use { salida -> origen.copyTo(salida) }
        }
        return ArchivoPreparado(destino, mime, extension.lowercase(), fueComprimido = false)
    }

    private fun subirADrive(
        archivo: File,
        nombre: String,
        mime: String,
        destino: DestinoDrive
    ) {
        val metadata = JsonObject().apply {
            addProperty("name", nombre)
            addProperty("mimeType", mime)
            add("parents", gson.toJsonTree(listOf(destino.carpetaId)))
        }.toString()

        val inicio = Request.Builder()
            .url("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true")
            .addHeader("Authorization", "Bearer ${destino.token}")
            .addHeader("Content-Type", "application/json; charset=UTF-8")
            .post(metadata.toRequestBody("application/json".toMediaType()))
            .build()

        val urlCarga = clienteHttp.newCall(inicio).execute().use { response ->
            if (!response.isSuccessful) throw Exception("Drive no inició la carga (${response.code})")
            response.header("Location") ?: throw Exception("Drive no devolvió URL de carga")
        }

        val tipo = mime.toMediaTypeOrNull() ?: "application/octet-stream".toMediaType()
        val carga = Request.Builder()
            .url(urlCarga)
            .put(archivo.asRequestBody(tipo))
            .build()

        clienteHttp.newCall(carga).execute().use { response ->
            if (!response.isSuccessful) throw Exception("Drive rechazó la carga (${response.code})")
        }
    }

    private fun obtenerNombre(uri: Uri): String {
        var nombre = uri.lastPathSegment ?: "archivo"
        if (uri.scheme == "content") {
            applicationContext.contentResolver.query(uri, null, null, null, null)?.use { cursor ->
                val indice = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (cursor.moveToFirst() && indice >= 0) nombre = cursor.getString(indice)
            }
        }
        return nombre
    }

    private suspend fun publicarMensaje(mensaje: String) {
        setForeground(crearForegroundInfo(progresoActual.get(), totalActual, mensaje))
    }

    private suspend fun publicarProgreso(completados: Int, total: Int, mensaje: String) {
        progresoActual.set(completados)
        totalActual = total
        setProgress(
            workDataOf(
                KEY_COMPLETADOS to completados,
                KEY_TOTAL to total,
                KEY_MENSAJE to mensaje
            )
        )
        setForeground(crearForegroundInfo(completados, total, mensaje))
    }

    private fun crearForegroundInfo(completados: Int, total: Int, mensaje: String): ForegroundInfo {
        crearCanalNotificaciones()
        val abrirApp = PendingIntent.getActivity(
            applicationContext,
            0,
            Intent(applicationContext, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val cancelar = WorkManager.getInstance(applicationContext).createCancelPendingIntent(id)
        val notificacion = NotificationCompat.Builder(applicationContext, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("Evidencias Bitácora")
            .setContentText(mensaje)
            .setContentIntent(abrirApp)
            .setOnlyAlertOnce(true)
            .setOngoing(completados < total)
            .setProgress(total.coerceAtLeast(1), completados, total <= 0)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Cancelar", cancelar)
            .build()

        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ForegroundInfo(NOTIFICATION_ID, notificacion, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            ForegroundInfo(NOTIFICATION_ID, notificacion)
        }
    }

    private fun crearCanalNotificaciones() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = applicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                "Carga de evidencias",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Muestra el avance de compresión y carga a Drive"
            }
        )
    }

    private fun resultadoData(completados: Int, total: Int, originales: Int, fallidos: Int): Data =
        workDataOf(
            KEY_COMPLETADOS to completados,
            KEY_TOTAL to total,
            KEY_ORIGINALES to originales,
            KEY_FALLIDOS to fallidos
        )

    private fun errorData(mensaje: String): Data = workDataOf(KEY_ERROR to mensaje)

    companion object {
        const val WORK_TAG = "evidence_upload"
        const val KEY_JOB_ID = "job_id"
        const val KEY_COMPLETADOS = "completed"
        const val KEY_TOTAL = "total"
        const val KEY_MENSAJE = "message"
        const val KEY_ORIGINALES = "originals"
        const val KEY_FALLIDOS = "failed"
        const val KEY_ERROR = "error"

        private const val CHANNEL_ID = "evidence_uploads"
        private const val NOTIFICATION_ID = 4102
        private const val MAX_REINTENTOS = 3
    }
}
