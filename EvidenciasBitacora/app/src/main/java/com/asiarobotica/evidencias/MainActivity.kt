package com.asiarobotica.evidencias

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.OpenableColumns
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.ImageButton
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.Spinner
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.workDataOf
import com.bumptech.glide.Glide
import com.google.gson.Gson
import com.google.gson.JsonObject
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.util.UUID
import java.util.concurrent.TimeUnit

class MainActivity : AppCompatActivity() {

    private lateinit var layoutPaso1: LinearLayout
    private lateinit var layoutPaso2: LinearLayout
    private lateinit var tvEquipoConfirmado: TextView
    private lateinit var tvTituloPaso2: TextView
    private lateinit var tvEtiquetaCategoria: TextView
    private lateinit var cardCategoria: View
    private lateinit var layoutBotonesArchivos: LinearLayout
    private lateinit var etNumeroSerie: EditText
    private lateinit var btnValidar: Button
    private lateinit var spinnerCategoria: Spinner
    private lateinit var layoutSerieExterna: LinearLayout
    private lateinit var cbAgregarSerieExterna: CheckBox
    private lateinit var etSerieExterna: EditText
    private lateinit var btnAbrirGaleria: Button
    private lateinit var btnAbrirCamara: Button
    private lateinit var tvContadorArchivos: TextView
    private lateinit var rvMiniaturas: RecyclerView
    private lateinit var adaptadorArchivos: ArchivosAdapter
    private lateinit var btnSubir: Button
    private lateinit var btnCambiarEquipo: Button
    private lateinit var layoutProgreso: LinearLayout
    private lateinit var tvProgresoTotal: TextView
    private lateinit var tvProgresoArchivo: TextView
    private lateinit var barraProgreso: ProgressBar
    private lateinit var tvEstado: TextView

    private val listaUrisArchivos = mutableListOf<Uri>()
    private var numeroSerieActual = ""
    private var maquinaActual = MAQUINA_NO_ENCONTRADA
    private var uriFotoCamaraTemporal: Uri? = null
    private var trabajoObservado: UUID? = null
    private var dialogoActualizacion: AlertDialog? = null

    private val clienteHttp = OkHttpClient.Builder()
        .connectTimeout(60, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .build()
    private val gson = Gson()

    private val lanzadorGaleria = registerForActivityResult(
        ActivityResultContracts.OpenMultipleDocuments()
    ) { uris ->
        var agregados = 0
        uris.forEach { uri ->
            val mime = contentResolver.getType(uri).orEmpty()
            if ((mime.startsWith("image/") || mime.startsWith("video/")) && uri !in listaUrisArchivos) {
                try {
                    contentResolver.takePersistableUriPermission(
                        uri,
                        Intent.FLAG_GRANT_READ_URI_PERMISSION
                    )
                } catch (_: SecurityException) {
                }
                listaUrisArchivos.add(uri)
                agregados++
            }
        }

        if (agregados > 0) {
            adaptadorArchivos.notifyItemRangeInserted(listaUrisArchivos.size - agregados, agregados)
            actualizarContador()
        }
    }

    private val lanzadorCamara = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { resultado ->
        if (resultado.resultCode == Activity.RESULT_OK) {
            uriFotoCamaraTemporal?.let { uri ->
                listaUrisArchivos.add(uri)
                adaptadorArchivos.notifyItemInserted(listaUrisArchivos.lastIndex)
                actualizarContador()
            }
        }
    }

    private val lanzadorPermisoNotificaciones = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) {
        encolarSubidaPersistente()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        vincularVistas()
        configurarSpinner()
        configurarRecyclerView()

        btnValidar.setOnClickListener { validarNumeroSerie() }
        btnAbrirGaleria.setOnClickListener { abrirGaleria() }
        btnAbrirCamara.setOnClickListener { abrirCamara() }
        btnSubir.setOnClickListener { iniciarSubidaMasiva() }
        btnCambiarEquipo.setOnClickListener { reiniciarFormularioTotal() }
        restaurarTrabajoExistente()
        verificarActualizacionObligatoria()
    }

    private fun verificarActualizacionObligatoria() {
        lifecycleScope.launch(Dispatchers.IO) {
            try {
                val url = BackendConfig.APPS_SCRIPT_URL.toHttpUrl().newBuilder()
                    .addQueryParameter("accion", "version")
                    .build()
                val cuerpo = clienteHttp.newCall(Request.Builder().url(url).build()).execute().use { response ->
                    if (!response.isSuccessful) return@use ""
                    response.body?.string().orEmpty()
                }
                if (cuerpo.isBlank()) return@launch

                val json = gson.fromJson(cuerpo, JsonObject::class.java)
                if (json.get("exito")?.asBoolean != true) return@launch

                val versionMinima = json.get("versionMinima")?.asLong ?: return@launch
                if (obtenerVersionCodeActual() >= versionMinima) return@launch

                val versionActual = json.get("versionActual")?.asString.orEmpty()
                val urlActualizacion = json.get("urlActualizacion")?.asString.orEmpty()
                val mensaje = json.get("mensaje")?.asString
                    ?: "Hay una actualización obligatoria disponible."

                withContext(Dispatchers.Main) {
                    mostrarActualizacionObligatoria(mensaje, versionActual, urlActualizacion)
                }
            } catch (_: Exception) {
            }
        }
    }

    @Suppress("DEPRECATION")
    private fun obtenerVersionCodeActual(): Long {
        val informacion = packageManager.getPackageInfo(packageName, 0)
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            informacion.longVersionCode
        } else {
            informacion.versionCode.toLong()
        }
    }

    private fun mostrarActualizacionObligatoria(
        mensaje: String,
        versionActual: String,
        urlActualizacion: String
    ) {
        if (isFinishing || isDestroyed || dialogoActualizacion?.isShowing == true) return

        val texto = if (versionActual.isBlank()) mensaje else "$mensaje\n\nVersión disponible: $versionActual"
        val dialogo = AlertDialog.Builder(this)
            .setTitle("Actualización obligatoria")
            .setMessage(texto)
            .setPositiveButton("Actualizar ahora", null)
            .create()

        dialogo.setCancelable(false)
        dialogo.setCanceledOnTouchOutside(false)
        dialogo.setOnShowListener {
            dialogo.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                if (urlActualizacion.isBlank()) {
                    Toast.makeText(this, "No se encontró el enlace de actualización.", Toast.LENGTH_LONG).show()
                    return@setOnClickListener
                }

                try {
                    startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(urlActualizacion)))
                } catch (_: Exception) {
                    Toast.makeText(this, "No se pudo abrir la carpeta de actualización.", Toast.LENGTH_LONG).show()
                }
            }
        }
        dialogo.show()
        dialogoActualizacion = dialogo
    }

    private fun vincularVistas() {
        layoutPaso1 = findViewById(R.id.layoutPaso1)
        layoutPaso2 = findViewById(R.id.layoutPaso2)
        tvEquipoConfirmado = findViewById(R.id.tvEquipoConfirmado)
        tvTituloPaso2 = findViewById(R.id.tvTituloPaso2)
        tvEtiquetaCategoria = findViewById(R.id.tvEtiquetaCategoria)
        cardCategoria = findViewById(R.id.cardCategoria)
        layoutBotonesArchivos = findViewById(R.id.layoutBotonesArchivos)
        etNumeroSerie = findViewById(R.id.etNumeroSerie)
        btnValidar = findViewById(R.id.btnValidar)
        spinnerCategoria = findViewById(R.id.spinnerCategoria)
        layoutSerieExterna = findViewById(R.id.layoutSerieExterna)
        cbAgregarSerieExterna = findViewById(R.id.cbAgregarSerieExterna)
        etSerieExterna = findViewById(R.id.etSerieExterna)
        btnAbrirGaleria = findViewById(R.id.btnAbrirGaleria)
        btnAbrirCamara = findViewById(R.id.btnAbrirCamara)
        tvContadorArchivos = findViewById(R.id.tvContadorArchivos)
        rvMiniaturas = findViewById(R.id.rvMiniaturas)
        btnSubir = findViewById(R.id.btnSubir)
        btnCambiarEquipo = findViewById(R.id.btnCambiarEquipo)
        layoutProgreso = findViewById(R.id.layoutProgreso)
        tvProgresoTotal = findViewById(R.id.tvProgresoTotal)
        tvProgresoArchivo = findViewById(R.id.tvProgresoArchivo)
        barraProgreso = findViewById(R.id.barraProgreso)
        tvEstado = findViewById(R.id.tvEstado)
    }

    private fun configurarSpinner() {
        val opciones = arrayOf("Estético", "Funcional", "Salida", "Modificaciones")
        spinnerCategoria.adapter = object : ArrayAdapter<String>(
            this,
            android.R.layout.simple_spinner_item,
            opciones
        ) {
            override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
                return (super.getView(position, convertView, parent) as TextView).apply {
                    setTextColor(android.graphics.Color.WHITE)
                    textSize = 16f
                    setPadding(0, 0, 0, 0)
                }
            }

            override fun getDropDownView(position: Int, convertView: View?, parent: ViewGroup): View {
                return (super.getDropDownView(position, convertView, parent) as TextView).apply {
                    setTextColor(android.graphics.Color.WHITE)
                    setBackgroundColor(android.graphics.Color.parseColor("#393D42"))
                    setPadding(40, 40, 40, 40)
                }
            }
        }
        spinnerCategoria.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(
                parent: AdapterView<*>?,
                view: View?,
                position: Int,
                id: Long
            ) {
                actualizarVisibilidadSerieExterna()
            }

            override fun onNothingSelected(parent: AdapterView<*>?) {
                actualizarVisibilidadSerieExterna()
            }
        }
        cbAgregarSerieExterna.setOnCheckedChangeListener { _, _ ->
            etSerieExterna.error = null
            actualizarVisibilidadSerieExterna()
        }
    }

    private fun actualizarVisibilidadSerieExterna() {
        val mostrar = spinnerCategoria.selectedItem?.toString() == "Salida" &&
            layoutPaso2.visibility == View.VISIBLE &&
            btnSubir.visibility == View.VISIBLE && btnSubir.isEnabled
        layoutSerieExterna.visibility = if (mostrar) View.VISIBLE else View.GONE
        etSerieExterna.visibility = if (mostrar && cbAgregarSerieExterna.isChecked) {
            View.VISIBLE
        } else {
            View.GONE
        }
    }

    private fun validarSerieExterna(): Boolean {
        if (spinnerCategoria.selectedItem?.toString() != "Salida" ||
            !cbAgregarSerieExterna.isChecked
        ) return true

        val serie = etSerieExterna.text.toString().trim()
        if (serie.isEmpty() || serie.length > 100 || serie.any { it.code < 32 }) {
            etSerieExterna.error = "Ingresa un número de serie externo válido."
            etSerieExterna.requestFocus()
            mostrarEstado("Ingresa el número de serie externo.", "#DC3545")
            return false
        }
        etSerieExterna.error = null
        return true
    }

    private fun configurarRecyclerView() {
        adaptadorArchivos = ArchivosAdapter(listaUrisArchivos)
        rvMiniaturas.layoutManager = LinearLayoutManager(this, LinearLayoutManager.HORIZONTAL, false)
        rvMiniaturas.adapter = adaptadorArchivos
    }

    private fun abrirGaleria() {
        layoutProgreso.visibility = View.GONE
        ocultarEstado()
        lanzadorGaleria.launch(arrayOf("image/*", "video/*"))
    }

    private fun abrirCamara() {
        layoutProgreso.visibility = View.GONE
        ocultarEstado()
        try {
            val archivoTemp = File(cacheDir, "camara_${System.currentTimeMillis()}.jpg")
            uriFotoCamaraTemporal = FileProvider.getUriForFile(
                this,
                "${applicationContext.packageName}.provider",
                archivoTemp
            )
            val intent = Intent(android.provider.MediaStore.ACTION_IMAGE_CAPTURE).apply {
                putExtra(android.provider.MediaStore.EXTRA_OUTPUT, uriFotoCamaraTemporal)
                addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            lanzadorCamara.launch(intent)
        } catch (error: Exception) {
            mostrarEstado("Error al abrir la cámara: ${error.message}", "#DC3545")
        }
    }

    private fun validarNumeroSerie() {
        val numSerie = etNumeroSerie.text.toString().trim()
        if (numSerie.isEmpty()) {
            mostrarEstado("Ingresa el número de serie.", "#DC3545")
            return
        }

        etNumeroSerie.isEnabled = false
        btnValidar.isEnabled = false
        btnValidar.text = "Buscando…"
        ocultarEstado()

        lifecycleScope.launch(Dispatchers.IO) {
            try {
                val url = BackendConfig.APPS_SCRIPT_URL.toHttpUrl().newBuilder()
                    .addQueryParameter("accion", "validar")
                    .addQueryParameter("numSerie", numSerie)
                    .build()
                val cuerpo = clienteHttp.newCall(Request.Builder().url(url).build()).execute().use { response ->
                    if (!response.isSuccessful) throw Exception("Servidor HTTP ${response.code}")
                    response.body?.string().orEmpty()
                }
                val json = gson.fromJson(cuerpo, JsonObject::class.java)
                val exito = json.get("exito")?.asBoolean == true
                val mensaje = json.get("mensaje")?.asString ?: "Respuesta inválida"
                val maquina = json.get("maquina")?.asString?.trim()
                    ?.takeIf { it.isNotEmpty() }
                    ?: MAQUINA_NO_ENCONTRADA

                withContext(Dispatchers.Main) {
                    if (exito) {
                        numeroSerieActual = numSerie
                        maquinaActual = maquina
                        etNumeroSerie.isEnabled = false
                        btnValidar.visibility = View.GONE
                        tvEquipoConfirmado.text = "$maquinaActual · Serie: $numSerie"
                        layoutPaso2.visibility = View.VISIBLE
                        actualizarVisibilidadSerieExterna()
                        btnCambiarEquipo.text = "Cancelar y cambiar equipo"
                        btnCambiarEquipo.isEnabled = true
                        btnCambiarEquipo.visibility = View.VISIBLE
                        ocultarEstado()
                    } else {
                        mostrarEstado(mensaje, "#DC3545")
                        reactivarBusqueda()
                    }
                }
            } catch (error: Exception) {
                withContext(Dispatchers.Main) {
                    mostrarEstado("Error de conexión: ${error.message}", "#DC3545")
                    reactivarBusqueda()
                }
            }
        }
    }

    private fun iniciarSubidaMasiva() {
        if (listaUrisArchivos.isEmpty()) {
            mostrarEstado("Selecciona al menos un archivo.", "#DC3545")
            return
        }
        if (!validarSerieExterna()) return

        if (
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            lanzadorPermisoNotificaciones.launch(Manifest.permission.POST_NOTIFICATIONS)
        } else {
            encolarSubidaPersistente()
        }
    }

    private fun encolarSubidaPersistente() {
        if (listaUrisArchivos.isEmpty() || numeroSerieActual.isBlank()) return
        if (!validarSerieExterna()) return

        val jobId = UUID.randomUUID().toString()
        val categoria = spinnerCategoria.selectedItem.toString()
        val serieExterna = if (categoria == "Salida" && cbAgregarSerieExterna.isChecked) {
            etSerieExterna.text.toString().trim()
        } else {
            null
        }
        val job = UploadJob(
            id = jobId,
            numeroSerie = numeroSerieActual,
            categoria = categoria,
            archivos = listaUrisArchivos.mapIndexed { indice, uri ->
                UploadJobItem(uri.toString(), indice + 1)
            }.toMutableList(),
            numeroSerieExterno = serieExterna
        )

        try {
            UploadJobStore.guardar(this, job)
        } catch (error: Exception) {
            mostrarEstado("No se pudo guardar la cola: ${error.message}", "#DC3545")
            return
        }

        val restricciones = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()
        val solicitud = OneTimeWorkRequestBuilder<EvidenceUploadWorker>()
            .setInputData(workDataOf(EvidenceUploadWorker.KEY_JOB_ID to jobId))
            .setConstraints(restricciones)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .addTag(EvidenceUploadWorker.WORK_TAG)
            .addTag("job:$jobId")
            .build()

        getSharedPreferences(PREFS, MODE_PRIVATE).edit()
            .putString(PREF_WORK_ID, solicitud.id.toString())
            .putString(PREF_JOB_ID, jobId)
            .putString(PREF_SERIE, numeroSerieActual)
            .putString(PREF_MAQUINA, maquinaActual)
            .putString(PREF_CATEGORIA, categoria)
            .apply()

        bloquearControles()
        layoutProgreso.visibility = View.VISIBLE
        tvProgresoTotal.text = "Archivos procesados: 0 / ${job.archivos.size}"
        tvProgresoArchivo.text = ""
        barraProgreso.progress = 0
        ocultarEstado()

        WorkManager.getInstance(this).enqueue(solicitud)
        observarTrabajo(solicitud.id)
    }

    private fun observarTrabajo(id: UUID) {
        if (trabajoObservado == id) return
        trabajoObservado = id
        WorkManager.getInstance(this).getWorkInfoByIdLiveData(id).observe(this) { info ->
            if (trabajoObservado != id) return@observe
            if (info == null) return@observe
            when (info.state) {
                WorkInfo.State.ENQUEUED, WorkInfo.State.BLOCKED -> {
                    bloquearControles()
                    layoutProgreso.visibility = View.VISIBLE
                    tvProgresoArchivo.text = "Esperando conexión o turno de Android…"
                }

                WorkInfo.State.RUNNING -> mostrarProgreso(info)
                WorkInfo.State.SUCCEEDED -> mostrarTrabajoExitoso(info)
                WorkInfo.State.FAILED -> mostrarTrabajoFallido(info)
                WorkInfo.State.CANCELLED -> {
                    reactivarControles()
                    restaurarArchivosPendientes()
                    mostrarEstado("Carga cancelada.", "#393D42")
                    tvProgresoArchivo.text = "Cancelado"
                }
            }
        }
    }

    private fun mostrarProgreso(info: WorkInfo) {
        bloquearControles()
        layoutProgreso.visibility = View.VISIBLE
        val completados = info.progress.getInt(EvidenceUploadWorker.KEY_COMPLETADOS, 0)
        val total = info.progress.getInt(EvidenceUploadWorker.KEY_TOTAL, listaUrisArchivos.size)
        val mensaje = info.progress.getString(EvidenceUploadWorker.KEY_MENSAJE) ?: "Procesando…"
        tvProgresoTotal.text = "Archivos procesados: $completados / $total"
        tvProgresoArchivo.text = mensaje
        barraProgreso.progress = if (total > 0) completados * 100 / total else 0
        ocultarEstado()
    }

    private fun mostrarTrabajoExitoso(info: WorkInfo) {
        val total = info.outputData.getInt(EvidenceUploadWorker.KEY_TOTAL, listaUrisArchivos.size)
        val originales = info.outputData.getInt(EvidenceUploadWorker.KEY_ORIGINALES, 0)
        tvProgresoTotal.text = "Archivos procesados: $total / $total"
        barraProgreso.progress = 100
        tvProgresoArchivo.text = "Finalizado"
        if (originales == 0) {
            mostrarEstado("Carga finalizada.", "#393D42")
        } else {
            mostrarEstado("Carga finalizada: $originales sin comprimir.", "#393D42")
        }

        btnSubir.visibility = View.GONE
        btnAbrirGaleria.visibility = View.GONE
        btnAbrirCamara.visibility = View.GONE
        rvMiniaturas.visibility = View.GONE
        layoutSerieExterna.visibility = View.GONE
        (spinnerCategoria.parent as View).visibility = View.GONE
        btnCambiarEquipo.text = "Buscar otro equipo"
        btnCambiarEquipo.isEnabled = true
        btnCambiarEquipo.visibility = View.VISIBLE
        adaptadorArchivos.setBloqueado(true)
        limpiarEstadoPersistente(info.id)
    }

    private fun mostrarTrabajoFallido(info: WorkInfo) {
        reactivarControles()
        restaurarArchivosPendientes()
        val error = info.outputData.getString(EvidenceUploadWorker.KEY_ERROR)
        val fallidos = info.outputData.getInt(EvidenceUploadWorker.KEY_FALLIDOS, listaUrisArchivos.size)
        mostrarEstado(error ?: "$fallidos archivo(s) no pudieron subirse.", "#DC3545")
        tvProgresoArchivo.text = "Puedes volver a intentar; los archivos exitosos no se repetirán."
    }

    private fun restaurarTrabajoExistente() {
        val prefs = getSharedPreferences(PREFS, MODE_PRIVATE)
        val workIdGuardado = prefs.getString(PREF_WORK_ID, null) ?: return
        val workId = try {
            UUID.fromString(workIdGuardado)
        } catch (_: IllegalArgumentException) {
            limpiarEstadoPersistente()
            return
        }

        btnValidar.isEnabled = false
        lifecycleScope.launch {
            val consulta = withContext(Dispatchers.IO) {
                runCatching { WorkManager.getInstance(applicationContext).getWorkInfoById(workId).get() }
            }
            val info = consulta.getOrNull()
            if (consulta.isSuccess && (info == null || info.state.isFinished)) {
                limpiarEstadoPersistente(workId)
                reactivarBusqueda()
                return@launch
            }

            restaurarFormularioPersistente(workId)
        }
    }

    private fun restaurarFormularioPersistente(workId: UUID) {
        val prefs = getSharedPreferences(PREFS, MODE_PRIVATE)

        numeroSerieActual = prefs.getString(PREF_SERIE, "").orEmpty()
        maquinaActual = prefs.getString(PREF_MAQUINA, MAQUINA_NO_ENCONTRADA)
            .orEmpty()
            .ifBlank { MAQUINA_NO_ENCONTRADA }
        if (numeroSerieActual.isNotBlank()) {
            etNumeroSerie.setText(numeroSerieActual)
            etNumeroSerie.isEnabled = false
            btnValidar.visibility = View.GONE
            tvEquipoConfirmado.text = "$maquinaActual · Serie: $numeroSerieActual"
            layoutPaso2.visibility = View.VISIBLE
            btnCambiarEquipo.text = "Cancelar y cambiar equipo"
            btnCambiarEquipo.visibility = View.VISIBLE
        }

        val categoria = prefs.getString(PREF_CATEGORIA, null)
        if (categoria != null) {
            val adaptador = spinnerCategoria.adapter
            val posicion = (0 until adaptador.count).firstOrNull {
                adaptador.getItem(it)?.toString() == categoria
            } ?: -1
            if (posicion >= 0) spinnerCategoria.setSelection(posicion)
        }

        prefs.getString(PREF_JOB_ID, null)?.let { jobId ->
            UploadJobStore.cargar(this, jobId)?.let { job ->
                etSerieExterna.setText(job.numeroSerieExterno.orEmpty())
                cbAgregarSerieExterna.isChecked = !job.numeroSerieExterno.isNullOrBlank()
                listaUrisArchivos.clear()
                listaUrisArchivos.addAll(job.archivos.map { Uri.parse(it.uri) })
                adaptadorArchivos.notifyDataSetChanged()
                actualizarContador()
            }
        }
        actualizarVisibilidadSerieExterna()
        observarTrabajo(workId)
    }

    private fun limpiarEstadoPersistente(workId: UUID? = null) {
        val prefs = getSharedPreferences(PREFS, MODE_PRIVATE)
        if (workId != null && prefs.getString(PREF_WORK_ID, null) != workId.toString()) return
        prefs.getString(PREF_JOB_ID, null)?.let { jobId ->
            runCatching { UploadJobStore.eliminar(this, jobId) }
        }
        prefs.edit().clear().apply()
    }

    private fun restaurarArchivosPendientes() {
        val prefs = getSharedPreferences(PREFS, MODE_PRIVATE)
        val jobId = prefs.getString(PREF_JOB_ID, null) ?: return
        val job = UploadJobStore.cargar(this, jobId) ?: return
        listaUrisArchivos.clear()
        listaUrisArchivos.addAll(job.archivos.filterNot { it.completado }.map { Uri.parse(it.uri) })
        adaptadorArchivos.notifyDataSetChanged()
        actualizarContador()
    }

    private fun actualizarContador() {
        if (listaUrisArchivos.isEmpty()) {
            tvContadorArchivos.text = "Ningún archivo seleccionado"
            tvContadorArchivos.setTextColor(getColor(android.R.color.darker_gray))
            return
        }

        val fotos = listaUrisArchivos.count {
            contentResolver.getType(it).orEmpty().startsWith("image/")
        }
        val videos = listaUrisArchivos.count {
            contentResolver.getType(it).orEmpty().startsWith("video/")
        }
        tvContadorArchivos.text = "$fotos foto(s) · $videos video(s) seleccionados"
        tvContadorArchivos.setTextColor(android.graphics.Color.parseColor("#E60404"))
    }

    private fun bloquearControles() {
        btnSubir.visibility = View.VISIBLE
        btnSubir.isEnabled = false
        btnSubir.alpha = 0.45f
        btnSubir.text = "Subiendo…"
        btnAbrirGaleria.isEnabled = false
        btnAbrirCamara.isEnabled = false
        spinnerCategoria.isEnabled = false
        cbAgregarSerieExterna.isEnabled = false
        etSerieExterna.isEnabled = false
        btnCambiarEquipo.isEnabled = false
        tvTituloPaso2.visibility = View.GONE
        tvEtiquetaCategoria.visibility = View.GONE
        cardCategoria.visibility = View.GONE
        layoutSerieExterna.visibility = View.GONE
        layoutBotonesArchivos.visibility = View.GONE
        btnCambiarEquipo.visibility = View.GONE
        adaptadorArchivos.setBloqueado(true)
    }

    private fun reactivarControles() {
        btnSubir.visibility = View.VISIBLE
        btnSubir.isEnabled = true
        btnSubir.alpha = 1f
        btnSubir.text = "Comprimir y subir a Drive"
        btnAbrirGaleria.visibility = View.VISIBLE
        btnAbrirGaleria.isEnabled = true
        btnAbrirCamara.visibility = View.VISIBLE
        btnAbrirCamara.isEnabled = true
        rvMiniaturas.visibility = View.VISIBLE
        tvTituloPaso2.visibility = View.VISIBLE
        tvEtiquetaCategoria.visibility = View.VISIBLE
        cardCategoria.visibility = View.VISIBLE
        layoutBotonesArchivos.visibility = View.VISIBLE
        (spinnerCategoria.parent as View).visibility = View.VISIBLE
        spinnerCategoria.isEnabled = true
        cbAgregarSerieExterna.isEnabled = true
        etSerieExterna.isEnabled = true
        actualizarVisibilidadSerieExterna()
        btnCambiarEquipo.isEnabled = true
        btnCambiarEquipo.visibility = View.VISIBLE
        adaptadorArchivos.setBloqueado(false)
    }

    private fun reactivarBusqueda() {
        etNumeroSerie.isEnabled = true
        btnValidar.isEnabled = true
        btnValidar.text = "Buscar Equipo"
    }

    private fun reiniciarFormularioTotal() {
        limpiarEstadoPersistente()

        listaUrisArchivos.clear()
        adaptadorArchivos.notifyDataSetChanged()
        adaptadorArchivos.setBloqueado(false)
        actualizarContador()
        numeroSerieActual = ""
        maquinaActual = MAQUINA_NO_ENCONTRADA
        trabajoObservado = null
        cbAgregarSerieExterna.isChecked = false
        etSerieExterna.text.clear()
        etSerieExterna.error = null
        spinnerCategoria.setSelection(0)

        etNumeroSerie.text.clear()
        etNumeroSerie.isEnabled = true
        btnValidar.visibility = View.VISIBLE
        reactivarBusqueda()
        tvEquipoConfirmado.text = ""
        layoutPaso2.visibility = View.GONE
        layoutProgreso.visibility = View.GONE
        btnCambiarEquipo.visibility = View.GONE
        btnCambiarEquipo.text = "Cancelar y cambiar equipo"
        reactivarControles()
        ocultarEstado()
        tvProgresoTotal.text = "Archivos procesados: 0 / 0"
        tvProgresoArchivo.text = ""
        barraProgreso.progress = 0
    }

    private fun obtenerNombreArchivo(uri: Uri): String {
        var nombre = uri.lastPathSegment ?: "archivo"
        if (uri.scheme == "content") {
            try {
                contentResolver.query(uri, null, null, null, null)?.use { cursor ->
                    val indice = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    if (cursor.moveToFirst() && indice >= 0) nombre = cursor.getString(indice)
                }
            } catch (_: Exception) {
            }
        }
        return nombre
    }

    private fun mostrarEstado(mensaje: String, colorHex: String) {
        tvEstado.text = mensaje
        tvEstado.setTextColor(android.graphics.Color.parseColor(colorHex))
        tvEstado.visibility = View.VISIBLE
    }

    private fun ocultarEstado() {
        tvEstado.text = ""
        tvEstado.visibility = View.GONE
    }

    inner class ArchivosAdapter(
        private val lista: MutableList<Uri>
    ) : RecyclerView.Adapter<ArchivosAdapter.ViewHolder>() {

        private var bloqueado = false

        inner class ViewHolder(view: View) : RecyclerView.ViewHolder(view) {
            val ivMiniatura: ImageView = view.findViewById(R.id.ivMiniatura)
            val btnEliminar: ImageButton = view.findViewById(R.id.btnEliminar)
            val tvNombreArchivo: TextView = view.findViewById(R.id.tvNombreArchivo)
        }

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
            val view = LayoutInflater.from(parent.context).inflate(R.layout.item_archivo, parent, false)
            return ViewHolder(view)
        }

        override fun onBindViewHolder(holder: ViewHolder, position: Int) {
            val uri = lista[position]
            holder.tvNombreArchivo.text = obtenerNombreArchivo(uri)
            Glide.with(holder.itemView.context).load(uri).centerCrop().into(holder.ivMiniatura)
            holder.btnEliminar.isEnabled = !bloqueado
            holder.btnEliminar.alpha = if (bloqueado) 0.35f else 1f
            holder.btnEliminar.setOnClickListener {
                if (bloqueado) return@setOnClickListener
                val posicion = holder.adapterPosition
                if (posicion != RecyclerView.NO_POSITION) {
                    lista.removeAt(posicion)
                    notifyItemRemoved(posicion)
                    actualizarContador()
                }
            }
        }

        override fun getItemCount(): Int = lista.size

        fun setBloqueado(valor: Boolean) {
            if (bloqueado == valor) return
            bloqueado = valor
            notifyDataSetChanged()
        }
    }

    companion object {
        private const val MAQUINA_NO_ENCONTRADA = "Máquina no encontrada"
        private const val PREFS = "upload_state"
        private const val PREF_WORK_ID = "work_id"
        private const val PREF_JOB_ID = "job_id"
        private const val PREF_SERIE = "serial"
        private const val PREF_MAQUINA = "machine"
        private const val PREF_CATEGORIA = "category"
    }
}
