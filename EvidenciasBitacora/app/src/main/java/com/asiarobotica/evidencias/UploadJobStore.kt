package com.asiarobotica.evidencias

import android.content.Context
import android.util.AtomicFile
import com.google.gson.Gson
import java.io.File

internal object BackendConfig {
    const val APPS_SCRIPT_URL =
        " "
}

internal data class UploadJob(
    val id: String,
    val numeroSerie: String,
    val categoria: String,
    val archivos: MutableList<UploadJobItem>,
    val numeroSerieExterno: String? = null
)

internal data class UploadJobItem(
    val uri: String,
    val indice: Int,
    var completado: Boolean = false,
    var subidoSinComprimir: Boolean = false,
    var error: String? = null
)

internal object UploadJobStore {
    private val gson = Gson()

    @Synchronized
    fun guardar(context: Context, job: UploadJob) {
        val archivoAtomico = AtomicFile(archivo(context, job.id))
        val salida = archivoAtomico.startWrite()
        try {
            salida.write(gson.toJson(job).toByteArray(Charsets.UTF_8))
            archivoAtomico.finishWrite(salida)
        } catch (error: Exception) {
            archivoAtomico.failWrite(salida)
            throw error
        }
    }

    @Synchronized
    fun cargar(context: Context, id: String): UploadJob? {
        val archivo = archivo(context, id)
        if (!archivo.exists()) return null
        val contenido = AtomicFile(archivo).openRead().bufferedReader(Charsets.UTF_8).use {
            it.readText()
        }
        return gson.fromJson(contenido, UploadJob::class.java)
    }

    @Synchronized
    fun eliminar(context: Context, id: String) {
        AtomicFile(archivo(context, id)).delete()
    }

    private fun archivo(context: Context, id: String): File {
        val directorio = File(context.filesDir, "upload_jobs")
        if (!directorio.exists() && !directorio.mkdirs()) {
            throw IllegalStateException("No se pudo crear el directorio de trabajos")
        }
        return File(directorio, "$id.json")
    }
}
