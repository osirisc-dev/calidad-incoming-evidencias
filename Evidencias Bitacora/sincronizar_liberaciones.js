function sincronizarDesdeHojaLiberaciones() {
  var propiedades = PropertiesService.getScriptProperties();
  var ultimoIdGuardado = Number(propiedades.getProperty('ULTIMO_ID_INSPECCION')) || 0; 
  
  var pendientesStr = propiedades.getProperty('IDS_PENDIENTES');
  var idsPendientes = pendientesStr ? JSON.parse(pendientesStr) : [];
  
  var idArchivoLiberaciones = ' ';
  var hojaLiberaciones = SpreadsheetApp.openById(idArchivoLiberaciones).getSheetByName('liberaciones');
  if (!hojaLiberaciones) return;

  var datosLiberaciones = hojaLiberaciones.getDataRange().getValues();
  if (datosLiberaciones.length <= 1) return;
  
  var colLib = {};
  datosLiberaciones[0].forEach(function(titulo, index) { colLib[titulo] = index; }); 
  
  var registros = [];
  for (var i = 1; i < datosLiberaciones.length; i++) {
    var fila = datosLiberaciones[i];
    var obj = {};
    for (var key in colLib) {
      obj[key] = fila[colLib[key]];
    }
    registros.push(obj);
  }
  
  var registrosAEvaluar = registros.filter(function(obj) {
    return obj.inspection_order_id > ultimoIdGuardado || idsPendientes.includes(obj.inspection_order_id);
  });

  if (registrosAEvaluar.length === 0) return;

  var idTuArchivo = ' '; 
  var hojaDestino = SpreadsheetApp.openById(idTuArchivo).getSheetByName('Bitácora');
  
  var colDest = {};
  hojaDestino.getRange(1, 1, 1, hojaDestino.getLastColumn()).getValues()[0].forEach(function(titulo, index) { 
    colDest[titulo] = index + 1; 
  }); 

  var colSerie = colDest["Número de serie interno"];
  if (!colSerie) return;

  var series = hojaDestino.getRange(1, colSerie, hojaDestino.getLastRow(), 1).getValues();
  var mapaFilas = {};
  for (var i = 1; i < series.length; i++) {
    if (series[i][0] !== "") {
      mapaFilas[String(series[i][0]).trim()] = i + 1; 
    }
  }

  var maxIdProcesado = ultimoIdGuardado;
  var nuevosPendientes = idsPendientes.slice(); 

  registrosAEvaluar.forEach(function(obj) {
    var id = obj.inspection_order_id;
    var status = obj.status;

    if (status === "FINISHED") {
      var serieAPI = String(obj.machine_serial).trim();
      var filaDestino = mapaFilas[serieAPI];

      if (filaDestino) { 
        var formatearCorreo = function(correo) {
          if (!correo) return "";
          return String(correo).trim().split('@')[0].replace(/\.prod$/i, '').replace(/\./g, ' ').toUpperCase();
        };

        if (obj.estacion && colDest["Estación"]) hojaDestino.getRange(filaDestino, colDest["Estación"]).setValue(obj.estacion);
        if (obj.equipo && colDest["Modelo del equipo"]) hojaDestino.getRange(filaDestino, colDest["Modelo del equipo"]).setValue(obj.equipo);
        
        if (obj.created_at) {
          if (colDest["Fecha inicio del equipo"]) hojaDestino.getRange(filaDestino, colDest["Fecha inicio del equipo"]).setValue(obj.created_at);
          if (colDest["Sem. de inicio"]) hojaDestino.getRange(filaDestino, colDest["Sem. de inicio"]).setValue(obtenerSemanaDelAno(new Date(obj.created_at)));
        }
        
        if (obj.operador_produccion && colDest["Operador principal"]) hojaDestino.getRange(filaDestino, colDest["Operador principal"]).setValue(formatearCorreo(obj.operador_produccion));
        if (obj.tech_support && colDest["Operador secundario"]) hojaDestino.getRange(filaDestino, colDest["Operador secundario"]).setValue(formatearCorreo(obj.tech_support));

        if (obj.inspection_type === "Inspección de pintura") {
          if (obj.started_at && colDest["Fecha liberación estética"]) hojaDestino.getRange(filaDestino, colDest["Fecha liberación estética"]).setValue(obj.started_at);
          if (obj.assigned_tech_email && colDest["Responsable liberación estética"]) hojaDestino.getRange(filaDestino, colDest["Responsable liberación estética"]).setValue(formatearCorreo(obj.assigned_tech_email));
        } else if (obj.inspection_type === "Inspección de ensamble") {
          if (obj.started_at && colDest["Fecha liberación funcional"]) hojaDestino.getRange(filaDestino, colDest["Fecha liberación funcional"]).setValue(obj.started_at);
          if (obj.assigned_tech_email && colDest["Responsable liberación funcional"]) hojaDestino.getRange(filaDestino, colDest["Responsable liberación funcional"]).setValue(formatearCorreo(obj.assigned_tech_email));
        }

        var fechaEstetica = colDest["Fecha liberación estética"] ? hojaDestino.getRange(filaDestino, colDest["Fecha liberación estética"]).getValue() : null;
        var fechaFuncional = colDest["Fecha liberación funcional"] ? hojaDestino.getRange(filaDestino, colDest["Fecha liberación funcional"]).getValue() : null;

        if (fechaEstetica && fechaFuncional && String(fechaEstetica).trim() !== "" && String(fechaFuncional).trim() !== "") {
          var dateEstetica = new Date(fechaEstetica);
          var dateFuncional = new Date(fechaFuncional);
          var fechaMasReciente = (dateEstetica > dateFuncional) ? dateEstetica : dateFuncional;

          if (colDest["Sem. término"]) hojaDestino.getRange(filaDestino, colDest["Sem. término"]).setValue(obtenerSemanaDelAno(fechaMasReciente));
          if (colDest["Mes"]) hojaDestino.getRange(filaDestino, colDest["Mes"]).setValue(fechaMasReciente.getMonth() + 1);
        }
      }

      var index = nuevosPendientes.indexOf(id);
      if (index !== -1) nuevosPendientes.splice(index, 1);

    } 
    else if (status === "IN_PROGRESS" || status === "PENDING") {
      if (!nuevosPendientes.includes(id)) {
        nuevosPendientes.push(id);
      }
    }
    else if (status === "CANCELED") {
      var index = nuevosPendientes.indexOf(id);
      if (index !== -1) nuevosPendientes.splice(index, 1);
    }

    if (id > maxIdProcesado) {
      maxIdProcesado = id;
    }
  });

  propiedades.setProperty('ULTIMO_ID_INSPECCION', maxIdProcesado.toString());
  propiedades.setProperty('IDS_PENDIENTES', JSON.stringify(nuevosPendientes));
}

function obtenerSemanaDelAno(fecha) {
  var date = new Date(fecha.getTime());
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
  var primeraSemana = new Date(date.getFullYear(), 0, 4);
  return 1 + Math.round(((date.getTime() - primeraSemana.getTime()) / 86400000 - 3 + (primeraSemana.getDay() + 6) % 7) / 7);
}

function inicializarID() {
  var prop = PropertiesService.getScriptProperties();
  prop.setProperty('ULTIMO_ID_INSPECCION', '1264'); 
  prop.setProperty('IDS_PENDIENTES', '[]'); 
}