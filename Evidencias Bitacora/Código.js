const CONFIG = Object.freeze({
  ID_HOJA_CALCULO: ' ',
  ID_HOJA_MODELOS: ' ',
  ID_CARPETA_RAIZ: ' ',
  NOMBRE_CARPETA_EVIDENCIAS: 'Evidencias bitacora',
  NOMBRE_PESTANA: 'Bitácora',
  NOMBRE_PESTANA_MODELOS: 'Respuestas',
  COLUMNA_SERIE: 5, 
  COLUMNA_SERIE_EXTERNA: 6, 
  COLUMNA_SERIE_MODELOS: 3, 
  COLUMNA_MODELO: 6, 
  MODELO_NO_ENCONTRADO: 'Máquina no encontrada',
  CATEGORIAS: Object.freeze(['Estético', 'Funcional', 'Salida', 'Modificaciones']),
  VERSION_MINIMA: 4,
  VERSION_ACTUAL: '4',
  URL_ACTUALIZACION: ' ',
  MENSAJE_ACTUALIZACION: 'Hay una actualización obligatoria disponible. Instálala para continuar usando la aplicación.'
});

function doGet(e) {
  try {
    const parametros = (e && e.parameter) || {};
    const accion = String(parametros.accion || '').trim();

    if (accion === 'validar') {
      return responderJson(validarSerie(parametros.numSerie));
    }

    if (accion === 'preparar') {
      return responderJson(prepararCarpetas(
        parametros.numSerie,
        parametros.categoria,
        parametros.numSerieExterno
      ));
    }

    if (accion === 'version') {
      return responderJson(obtenerVersionApp());
    }

    return responderJson({ exito: false, mensaje: 'Acción no válida.' });
  } catch (error) {
    console.error(error);
    return responderJson({ exito: false, mensaje: 'Error interno del servidor.' });
  }
}

function obtenerVersionApp() {
  return {
    exito: true,
    versionMinima: CONFIG.VERSION_MINIMA,
    versionActual: CONFIG.VERSION_ACTUAL,
    urlActualizacion: CONFIG.URL_ACTUALIZACION,
    mensaje: CONFIG.MENSAJE_ACTUALIZACION
  };
}

function validarSerie(numSerie) {
  try {
    const serie = normalizarSerie(numSerie);
    const hoja = obtenerHoja();
    const fila = buscarFilaSerie(hoja, serie);

    if (fila < 1) {
      return { exito: false, mensaje: 'El número de serie no existe en la base de datos.' };
    }

    return {
      exito: true,
      maquina: buscarModeloMaquina(serie)
    };
  } catch (error) {
    console.error(error);
    return { exito: false, mensaje: error.message };
  }
}

function prepararCarpetas(numSerie, categoria, numSerieExterno) {
  const bloqueo = LockService.getScriptLock();

  try {
    const serie = normalizarSerie(numSerie);
    const categoriaValida = validarCategoria(categoria);
    const serieExterna = validarSerieExterna(numSerieExterno, categoriaValida);
    const hoja = obtenerHoja();
    const fila = buscarFilaSerie(hoja, serie);

    if (fila < 1) {
      throw new Error('El número de serie ya no existe.');
    }

    if (!bloqueo.tryLock(10000)) {
      throw new Error('El servidor está ocupado. Intenta nuevamente.');
    }

    const unidadCompartida = DriveApp.getFolderById(CONFIG.ID_CARPETA_RAIZ);
    const carpetaEvidencias = obtenerOCrearCarpeta(
      unidadCompartida,
      CONFIG.NOMBRE_CARPETA_EVIDENCIAS
    );
    const carpetaEquipo = obtenerOCrearCarpeta(carpetaEvidencias, serie);
    const carpetaDestino = obtenerOCrearCarpeta(carpetaEquipo, categoriaValida);

    actualizarEnlaceSiHaceFalta(
      hoja,
      fila,
      CONFIG.COLUMNA_SERIE,
      serie,
      carpetaEquipo.getUrl()
    );

    if (serieExterna) {
      hoja.getRange(fila, CONFIG.COLUMNA_SERIE_EXTERNA).setRichTextValue(
        SpreadsheetApp.newRichTextValue().setText(serieExterna).build()
      );
    }

    return {
      exito: true,
      idCarpeta: carpetaDestino.getId(),
      token: ScriptApp.getOAuthToken(),
      numeroSerieExternoGuardado: serieExterna
    };
  } catch (error) {
    console.error(error);
    return { exito: false, mensaje: error.message };
  } finally {
    if (bloqueo.hasLock()) {
      bloqueo.releaseLock();
    }
  }
}

function obtenerHoja() {
  const documento = SpreadsheetApp.openById(CONFIG.ID_HOJA_CALCULO);
  const hoja = documento.getSheetByName(CONFIG.NOMBRE_PESTANA);

  if (!hoja) {
    throw new Error(`No se encontró la pestaña '${CONFIG.NOMBRE_PESTANA}'.`);
  }

  return hoja;
}

function buscarFilaSerie(hoja, serie) {
  const ultimaFila = hoja.getLastRow();
  if (ultimaFila < 2) return -1;

  const coincidencia = hoja
    .getRange(2, CONFIG.COLUMNA_SERIE, ultimaFila - 1, 1)
    .createTextFinder(serie)
    .matchEntireCell(true)
    .matchCase(false)
    .useRegularExpression(false)
    .findNext();

  return coincidencia ? coincidencia.getRow() : -1;
}

function buscarModeloMaquina(serie) {
  try {
    const documento = SpreadsheetApp.openById(CONFIG.ID_HOJA_MODELOS);
    const hoja = documento.getSheetByName(CONFIG.NOMBRE_PESTANA_MODELOS);
    if (!hoja) return CONFIG.MODELO_NO_ENCONTRADO;

    const ultimaFila = hoja.getLastRow();
    if (ultimaFila < 2) return CONFIG.MODELO_NO_ENCONTRADO;

    const coincidencia = hoja
      .getRange(2, CONFIG.COLUMNA_SERIE_MODELOS, ultimaFila - 1, 1)
      .createTextFinder(serie)
      .matchEntireCell(true)
      .matchCase(false)
      .useRegularExpression(false)
      .findNext();

    if (!coincidencia) return CONFIG.MODELO_NO_ENCONTRADO;

    const modelo = String(
      hoja.getRange(coincidencia.getRow(), CONFIG.COLUMNA_MODELO).getDisplayValue() || ''
    ).trim();

    return modelo || CONFIG.MODELO_NO_ENCONTRADO;
  } catch (error) {
    console.warn(`No se pudo consultar el modelo para ${serie}: ${error.message}`);
    return CONFIG.MODELO_NO_ENCONTRADO;
  }
}

function obtenerOCrearCarpeta(carpetaPadre, nombre) {
  const carpetas = carpetaPadre.getFoldersByName(nombre);
  return carpetas.hasNext() ? carpetas.next() : carpetaPadre.createFolder(nombre);
}

function actualizarEnlaceSiHaceFalta(hoja, fila, columna, serie, url) {
  const celda = hoja.getRange(fila, columna);
  const textoEnriquecido = celda.getRichTextValue();
  if (textoEnriquecido && textoEnriquecido.getLinkUrl()) return;

  celda.setRichTextValue(
    SpreadsheetApp.newRichTextValue()
      .setText(serie)
      .setLinkUrl(url)
      .build()
  );
}

function normalizarSerie(valor) {
  const serie = String(valor || '').trim();
  if (!serie) throw new Error('Ingresa el número de serie.');
  if (serie.length > 100) throw new Error('El número de serie es demasiado largo.');
  if (/[\u0000-\u001F]/.test(serie)) throw new Error('El número de serie contiene caracteres no válidos.');
  return serie;
}

function validarCategoria(valor) {
  const categoria = String(valor || '').trim();
  if (CONFIG.CATEGORIAS.indexOf(categoria) < 0) {
    throw new Error('Categoría no válida.');
  }
  return categoria;
}

function validarSerieExterna(valor, categoria) {
  const serieExterna = String(valor || '').trim();
  if (!serieExterna) return '';
  if (categoria !== 'Salida') {
    throw new Error('El número de serie externo solo se admite en Salida.');
  }
  if (serieExterna.length > 100 || /[\u0000-\u001F]/.test(serieExterna)) {
    throw new Error('El número de serie externo no es válido.');
  }
  return serieExterna;
}

function responderJson(datos) {
  return ContentService
    .createTextOutput(JSON.stringify(datos))
    .setMimeType(ContentService.MimeType.JSON);
}
