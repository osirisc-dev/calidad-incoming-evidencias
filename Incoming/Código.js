function doGet() {
  var template = HtmlService.createTemplateFromFile('Index'); 
  
  var correoDetectado = "";
  try {
    correoDetectado = Session.getActiveUser().getEmail();
  } catch(e) {
    correoDetectado = "";
  }
  
  template.correoUsuario = correoDetectado;
  
  return template.evaluate()
      .setTitle('Reporte Incoming -  ')
      .setSandboxMode(HtmlService.SandboxMode.IFRAME)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0');
}

function obtenerMaquinas() {
  var idHojaIncoming = " "; 
  var hojaMaquinas = SpreadsheetApp.openById(idHojaIncoming).getSheetByName("BaseMaquinas");
  var datos = hojaMaquinas.getDataRange().getValues();
  var catalogo = {};
  
  for (var i = 1; i < datos.length; i++) {
    var maquina = datos[i][0]; var pieza = datos[i][2]; var criterio = datos[i][4];
    if (maquina) {
      if (!catalogo[maquina]) { catalogo[maquina] = []; }
      catalogo[maquina].push({ pieza: pieza, criterio: criterio });
    }
  }
  return catalogo;
}

function buscarFilasDeSerie(hoja, columna, serie) {
  var ultimaFila = hoja.getLastRow();
  if (ultimaFila < 2) return [];
  var serieBuscada = String(serie || '').trim().toUpperCase();
  if (!serieBuscada) return [];

  return hoja.getRange(2, columna, ultimaFila - 1, 1)
    .createTextFinder(serieBuscada)
    .matchCase(false)
    .matchEntireCell(false)
    .useRegularExpression(false)
    .findAll()
    .filter(function(coincidencia) {
      return String(coincidencia.getDisplayValue()).trim().toUpperCase() === serieBuscada;
    })
    .map(function(coincidencia) { return coincidencia.getRow(); });
}

function obtenerEstadoSerieIncoming(serie) {
  var serieLimpia = String(serie || '').trim();
  if (!serieLimpia) throw new Error('Ingresa el número de serie.');

  var libroIncoming = SpreadsheetApp.openById(' ');
  var hojaRespuestas = libroIncoming.getSheetByName('Respuestas');
  var libroBitacora = SpreadsheetApp.openById(' ');
  var hojaBitacora = libroBitacora.getSheetByName('Bitácora');
  if (!hojaRespuestas || !hojaBitacora) {
    throw new Error('No se encontró la pestaña Respuestas o Bitácora.');
  }

  return {
    hojaRespuestas: hojaRespuestas,
    hojaBitacora: hojaBitacora,
    filasIncoming: buscarFilasDeSerie(hojaRespuestas, 3, serieLimpia),
    filasBitacora: buscarFilasDeSerie(hojaBitacora, 5, serieLimpia)
  };
}

function consultarSerieExistente(serie) {
  var estado = obtenerEstadoSerieIncoming(serie);
  return {
    existe: estado.filasIncoming.length > 0 || estado.filasBitacora.length > 0,
    enIncoming: estado.filasIncoming.length > 0,
    enBitacora: estado.filasBitacora.length > 0
  };
}

function guardarFilaIncoming(hoja, filasExistentes, valores) {
  if (filasExistentes.length === 0) {
    hoja.appendRow(valores);
    return;
  }
  filasExistentes.forEach(function(fila) {
    hoja.getRange(fila, 1, 1, valores.length).setValues([valores]);
  });
}

function guardarFilasBitacora(hoja, filasExistentes, datosForm) {
  var fecha = new Date();
  if (filasExistentes.length > 0) {
    filasExistentes.forEach(function(fila) {
      hoja.getRange(fila, 2, 1, 1).setValues([[datosForm.proveedor]]);
      hoja.getRange(fila, 4, 1, 1).setValues([[fecha]]);
    });
    return filasExistentes;
  }

  var ultimaFilaSerie = 1;
  for (var fin = hoja.getLastRow(); fin >= 2 && ultimaFilaSerie === 1; fin -= 500) {
    var inicio = Math.max(2, fin - 499);
    var series = hoja.getRange(inicio, 5, fin - inicio + 1, 1).getDisplayValues();
    for (var f = series.length - 1; f >= 0; f--) {
      if (String(series[f][0]).trim() !== '') {
        ultimaFilaSerie = inicio + f;
        break;
      }
    }
  }

  var siguienteFila = ultimaFilaSerie + 1;
  if (siguienteFila > hoja.getMaxRows()) {
    hoja.insertRowsAfter(hoja.getMaxRows(), 1);
  }
  var celdasDestino = hoja.getRange(siguienteFila, 2, 1, 4).getDisplayValues()[0];
  if (celdasDestino.some(function(valor) { return String(valor).trim() !== ''; })) {
    throw new Error('La fila siguiente al último número de serie ya contiene datos en B:E.');
  }
  hoja.getRange(siguienteFila, 2, 1, 4).setValues([[
    datosForm.proveedor, datosForm.referencia, fecha, datosForm.serie
  ]]);
  return [siguienteFila];
}

function guardarDatos(datosForm) {
  try {
    var estadoInicial = obtenerEstadoSerieIncoming(datosForm.serie);
    if ((estadoInicial.filasIncoming.length || estadoInicial.filasBitacora.length) &&
        datosForm.confirmarSobrescritura !== true) {
      return 'Serie existente: confirma la sobrescritura antes de enviar el reporte.';
    }

    var idCarpetaFotos = " "; 
    var carpeta = DriveApp.getFolderById(idCarpetaFotos);
    var listadoResultados = [];

    for (var i = 0; i < datosForm.evaluaciones.length; i++) {
      var evaluacion = datosForm.evaluaciones[i];
      var textoPieza = evaluacion.pieza + ": " + evaluacion.seleccion;
      if (evaluacion.comentario) { textoPieza += " (Nota: " + evaluacion.comentario + ")"; }

      if (evaluacion.fotos && evaluacion.fotos.length > 0) {
        for (var j = 0; j < evaluacion.fotos.length; j++) {
          var fotoData = evaluacion.fotos[j];
          var partesDataUrl = fotoData.base64.split(',');
          var tipo = partesDataUrl[0].split(';')[0].replace('data:', '');
          var bytesImagen = Utilities.base64Decode(partesDataUrl[1]);
          var blob = Utilities.newBlob(bytesImagen, tipo, fotoData.nombre);
          var archivo = carpeta.createFile(blob);
          
          textoPieza += " [Foto: " + archivo.getUrl() + "]";
          fotoData.urlDirecta = archivo.getUrl(); 
        }
      }
      listadoResultados.push(textoPieza);
    }

    var textoResultadosFinal = listadoResultados.join(" | ");
    
    var valoresIncoming = [
      new Date(), 
      datosForm.correo, 
      datosForm.serie, 
      datosForm.contenedor,
      datosForm.referencia, 
      datosForm.nombreMaquina,
      textoResultadosFinal,
      datosForm.disposicion,
      datosForm.comentariosGenerales,
      datosForm.proveedor
    ];

    var urlReporte = generarReporteIndividualAutomatico(datosForm);
    if (datosForm.confirmarSobrescritura === true && !urlReporte) {
      return 'Error: no se generó el PDF nuevo. Los registros anteriores permanecen sin cambios.';
    }
    var bloqueo = LockService.getScriptLock();
    if (!bloqueo.tryLock(10000)) {
      return 'Error: otro reporte está guardándose. Intenta nuevamente.';
    }

    var filasDestino = [];
    var hojaBitacora = null;
    var errorBitacora = null;
    var errorEnlace = null;
    try {
      var estadoActual = obtenerEstadoSerieIncoming(datosForm.serie);
      if ((estadoActual.filasIncoming.length || estadoActual.filasBitacora.length) &&
          datosForm.confirmarSobrescritura !== true) {
        return 'Serie existente: confirma la sobrescritura antes de enviar el reporte.';
      }
      hojaBitacora = estadoActual.hojaBitacora;
      guardarFilaIncoming(estadoActual.hojaRespuestas, estadoActual.filasIncoming, valoresIncoming);
      try {
        filasDestino = guardarFilasBitacora(hojaBitacora, estadoActual.filasBitacora, datosForm);
      } catch(errExterno) {
        errorBitacora = errExterno;
        Logger.log('Error guardando en bitácora externa: ' + errExterno.toString());
      }

      if (urlReporte && hojaBitacora) {
        filasDestino.forEach(function(fila) {
          try {
            var serieEnBitacora = String(hojaBitacora.getRange(fila, 5).getDisplayValue() || '').trim();
            if (serieEnBitacora.toUpperCase() !== String(datosForm.serie).trim().toUpperCase()) {
              throw new Error('La serie de la fila no coincide con el reporte generado.');
            }
            hojaBitacora.getRange(fila, 3).setRichTextValue(
              SpreadsheetApp.newRichTextValue()
                .setText(String(datosForm.referencia || '').trim() || 'Abrir reporte')
                .setLinkUrl(urlReporte)
                .build()
            );
          } catch(errEnlace) {
            errorEnlace = errEnlace;
            Logger.log('Error creando el vínculo del reporte en Bitácora: ' + errEnlace.toString());
          }
        });
      }
    } finally {
      if (bloqueo.hasLock()) bloqueo.releaseLock();
    }

    var incidencias = [];
    if (errorBitacora) incidencias.push("no se copió a Bitácora");
    if (!urlReporte) incidencias.push("no se generó el PDF individual");
    if (errorEnlace) incidencias.push("no se enlazó el PDF en Bitácora");
    if (incidencias.length > 0) {
      return "Éxito parcial: el registro se guardó en Incoming, pero " +
        incidencias.join(" y ") + ". No vuelvas a enviarlo; solicita revisar la serie " + datosForm.serie + ".";
    }
    return "Éxito";
  } catch(error) {
    return "Error: " + error.toString();
  }
}

function obtenerRefacciones() {
  var idHojaIncoming = " "; 
  var hojaRefacciones = SpreadsheetApp.openById(idHojaIncoming).getSheetByName("RefaccionesPendientes");
  
  if (!hojaRefacciones) return [];
  
  var datos = hojaRefacciones.getDataRange().getValues();
  var lista = [];
  
  for (var i = 1; i < datos.length; i++) {
    var arCode = datos[i][0]; 
    var erpCode = datos[i][1]; 
    var descripcion = datos[i][2];
    var ordenado = datos[i][3];
    var enviado = datos[i][4];
    
    if (arCode || erpCode) { 
      lista.push({ 
        arCode: arCode ? arCode.toString().trim() : "N/A", 
        erpCode: erpCode ? erpCode.toString().trim() : "N/A",
        descripcion: descripcion ? descripcion.toString().trim() : "Sin descripción",
        ordenado: ordenado ? ordenado.toString().trim() : "0",
        enviado: enviado ? enviado.toString().trim() : "0"
      });
    }
  }
  
  return lista;
}

function guardarRefacciones(datosForm) {
  try {
    var idHojaIncoming = " "; 
    var hojaRespuestas = SpreadsheetApp.openById(idHojaIncoming).getSheetByName("RespuestasRefacciones");
    var idCarpetaFotos = " "; 
    var carpeta = DriveApp.getFolderById(idCarpetaFotos);
    var listadoResultados = [];

    for (var i = 0; i < datosForm.evaluaciones.length; i++) {
      var evaluacion = datosForm.evaluaciones[i];
      var textoPieza = evaluacion.pieza + " [Cant: " + evaluacion.cantidad + "] [Disp: " + evaluacion.disposicionItem + "]: " + evaluacion.seleccion;
      if (evaluacion.comentario) { textoPieza += " (Nota: " + evaluacion.comentario + ")"; }

      if (evaluacion.fotos && evaluacion.fotos.length > 0) {
        for (var j = 0; j < evaluacion.fotos.length; j++) {
          var fotoData = evaluacion.fotos[j];
          var partesDataUrl = fotoData.base64.split(',');
          var tipo = partesDataUrl[0].split(';')[0].replace('data:', '');
          var bytesImagen = Utilities.base64Decode(partesDataUrl[1]);
          var blob = Utilities.newBlob(bytesImagen, tipo, fotoData.nombre);
          var archivo = carpeta.createFile(blob);
          
          textoPieza += " [Foto: " + archivo.getUrl() + "]";
          fotoData.urlDirecta = archivo.getUrl(); 
        }
      }
      listadoResultados.push(textoPieza);
    }

    var textoResultadosFinal = listadoResultados.join(" | ");
    
    hojaRespuestas.appendRow([
      new Date(), 
      datosForm.correo, 
      datosForm.contenedor,
      datosForm.referencia, 
      textoResultadosFinal
    ]);
    
    if (datosForm.codigoRefaccion) {
        var hojaPendientes = SpreadsheetApp.openById(idHojaIncoming).getSheetByName("RefaccionesPendientes");
        if (hojaPendientes) {
            var datosPendientes = hojaPendientes.getDataRange().getValues();
            for (var j = datosPendientes.length - 1; j >= 1; j--) {
                if (datosPendientes[j][1].toString().trim() === datosForm.codigoRefaccion.toString().trim()) {
                    hojaPendientes.deleteRow(j + 1); 
                    break; 
                }
            }
        }
    }
    
    return "Éxito";
  } catch(error) {
    return "Error: " + error.toString();
  }
}

function consultarRegistroPorSerie(serieBuscada) {
  try {
    var idHojaIncoming = " "; 
    var hojaRespuestas = SpreadsheetApp.openById(idHojaIncoming).getSheets()[0]; 
    var datos = hojaRespuestas.getDataRange().getValues();

    var serieLimpia = serieBuscada.toString().trim().toUpperCase();

    for (var i = datos.length - 1; i >= 1; i--) {
      var serieFila = datos[i][2] ? datos[i][2].toString().trim().toUpperCase() : "";
      
      if (serieFila === serieLimpia) {
        var inspectorCorreo = datos[i][1] ? datos[i][1].toString() : "Inspector";
        var nombreInspector = inspectorCorreo.split('@')[0];
        
        return {
          fecha: Utilities.formatDate(new Date(datos[i][0]), Session.getScriptTimeZone(), "dd/MM/yyyy"),
          inspector: nombreInspector.toUpperCase(),
          modelo: datos[i][5],
          contenedor: datos[i][3],
          referencia: datos[i][4]
        };
      }
    }
    return null; 
  } catch (e) {
    Logger.log("Error buscando serie: " + e.toString());
    throw new Error(e.toString()); 
  }
}

function guardarReclamacion(datos) {
  try {
    var idHojaIncoming = " "; 
    var libro = SpreadsheetApp.openById(idHojaIncoming);
    var hojaReclamaciones = libro.getSheetByName("Reclamaciones");
    
    if (!hojaReclamaciones) {
      hojaReclamaciones = libro.insertSheet("Reclamaciones");
      hojaReclamaciones.appendRow([
        "Fecha Reporte", "Auditor", "No. Serie", "Contenedor", "Referencia/Lote", 
        "Descripción Defecto", "Etapa Detección", "Justificación Detección Tardía", 
        "Evidencias Fotográficas", "Total Horas Invertidas", "Costo Estimado Total ($)", 
        "Requerimientos Proveedor", "Severidad Defecto", "Reincidencia Proveedor", "Impacto Cliente Final"
      ]);
      hojaReclamaciones.getRange("A1:O1").setFontWeight("bold").setBackground("#393D42").setFontColor("white");
    }

    var idCarpetaFotos = " "; 
    var carpeta = DriveApp.getFolderById(idCarpetaFotos);
    
    var urlsFotos = [];
    if (datos.fotos && datos.fotos.length > 0) {
      for (var j = 0; j < datos.fotos.length; j++) {
        var fotoData = datos.fotos[j];
        var partesDataUrl = fotoData.base64.split(',');
        var tipo = partesDataUrl[0].split(';')[0].replace('data:', '');
        var bytesImagen = Utilities.base64Decode(partesDataUrl[1]);
        var blob = Utilities.newBlob(bytesImagen, tipo, fotoData.nombre);
        var archivo = carpeta.createFile(blob);
        
        urlsFotos.push("[Foto: " + archivo.getUrl() + "]");
        fotoData.urlDirecta = archivo.getUrl(); 
      }
    }
    
    var textoEvidencias = urlsFotos.join("  ");
    
    var requerimientos = 
      "Acuse:" + datos.reqAcuse + " | Reposicion:" + datos.reqReposicion + 
      " | Compensacion:" + datos.reqCompensacion + " | RevisionLote:" + datos.reqRevision;

    hojaReclamaciones.appendRow([
      new Date(),
      datos.correo,
      datos.serie,
      datos.contenedor,
      datos.referencia,
      datos.defecto,
      datos.etapa,
      datos.justificacion,
      textoEvidencias,
      datos.cHoras,
      datos.cCosto,
      requerimientos,
      datos.clSeveridad,
      datos.clReincidencia,
      datos.clImpacto
    ]);

    try {
      if (typeof generarReporteReclamacionPDF === "function") {
        generarReporteReclamacionPDF(datos);
      }
    } catch(e) {
      Logger.log("Error generando el PDF de reclamación: " + e.toString());
    }

    return "Éxito";
  } catch(error) {
    return "Error: " + error.toString();
  }
}
