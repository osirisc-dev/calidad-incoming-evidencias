function traducirTexto(texto) {
  if (!texto || texto.toString().trim() === "") return "";
  
  var textoNormalizado = texto.toString().toLowerCase().trim();
  if (textoNormalizado === "sin observaciones" || textoNormalizado === "sin comentarios" || textoNormalizado === "sin comentarios generales registrados.") {
    return "";
  }
  
  try {
    return LanguageApp.translate(texto.toString().trim(), 'es', 'en');
  } catch (e) {
    Logger.log("Error en traducción automática: " + e.toString());
    return ""; 
  }
}

function generarReporteConsolidado() {
  var libro = SpreadsheetApp.getActiveSpreadsheet();
  var hojaPanel = libro.getSheetByName("Panel");
  var hojaRespuestas = libro.getSheets()[0]; 
  var hojaRefacciones = libro.getSheetByName("RespuestasRefacciones");
  
  var refBuscada = hojaPanel.getRange("B1").getValue().toString().trim();
  var contenedor = hojaPanel.getRange("B2").getValue().toString().trim();
  var proveedor  = hojaPanel.getRange("B3").getValue().toString().trim();
  var factura    = hojaPanel.getRange("B4").getValue().toString().trim();
  
  if (refBuscada === "") {
    SpreadsheetApp.getUi().alert("⚠️ Por favor escribe una Referencia en la celda B1.");
    return;
  }

  var hojaMaquinas = libro.getSheetByName("BaseMaquinas");
  var datosMaq = hojaMaquinas.getDataRange().getValues();
  var diccionarioModelos = {};
  var diccionarioBilingue = {};

  for (var m = 1; m < datosMaq.length; m++) {
    var maqCorto = datosMaq[m][0] ? datosMaq[m][0].toString().trim().toUpperCase() : "";
    var maqTecnico = datosMaq[m][1] ? datosMaq[m][1].toString().trim() : "";
    var piezaEsp = datosMaq[m][2] ? datosMaq[m][2].toString().trim() : "";
    var piezaIng = datosMaq[m][3] ? datosMaq[m][3].toString().trim() : "";
    if (maqCorto) { diccionarioModelos[maqCorto] = maqTecnico ? maqTecnico : maqCorto; }
    if (piezaEsp && piezaIng) { diccionarioBilingue[piezaEsp] = piezaIng; }
  }

  var idLogoDrive = " "; 
  var idFirmaJefe = " "; 
  var inspectores = {
    " ": " "
  };

  var imgLogoHtml = ""; try { var fL = DriveApp.getFileById(idLogoDrive); imgLogoHtml = "<img src='data:" + fL.getMimeType() + ";base64," + Utilities.base64Encode(fL.getBlob().getBytes()) + "' style='max-height:40px;' />"; } catch(e){}
  var imgJefeHtml = "<div style='height:100px;'></div>"; try { var fJ = DriveApp.getFileById(idFirmaJefe); imgJefeHtml = "<img src='data:" + fJ.getMimeType() + ";base64," + Utilities.base64Encode(fJ.getBlob().getBytes()) + "' style='max-height:100px; display:block; margin:0 auto 4px auto;' />"; } catch(e){}

  var datos = hojaRespuestas.getDataRange().getValues();
  var maquinasProcesadas = [];
  for (var i = 1; i < datos.length; i++) {
    var fila = datos[i];
    if (fila[4] && fila[4].toString().trim() === refBuscada) {
      
      var resultadosStr = fila[6] ? fila[6].toString().trim() : "";
      var bloquesPiezas = resultadosStr.split(" | ");
      var htmlFilasComponentes = "";

      for (var p = 0; p < bloquesPiezas.length; p++) {
        var bloque = bloquesPiezas[p].trim();
        if (!bloque) continue;

        var splitIndex = bloque.indexOf(":");
        if (splitIndex === -1) continue;

        var pieza = bloque.substring(0, splitIndex).trim();
        var detalles = bloque.substring(splitIndex + 1).trim();

        var urlsFotos = [];
        var matchFoto;
        while ((matchFoto = detalles.match(/\[Foto:\s*([^\]]*?)\]/))) {
          urlsFotos.push(matchFoto[1].trim());
          detalles = detalles.replace(matchFoto[0], "").trim();
        }

        var notaLimpia = "";
        var matchNota = detalles.match(/\(Nota:\s*(.*?)\)/);
        if (matchNota) { 
            notaLimpia = matchNota[1]; 
            detalles = detalles.replace(matchNota[0], "").trim(); 
        }

        var statusTexto = detalles; 
        var compBadgeStyle = "border: 1px solid #393D42; color: #393D42;";
        if (detalles.toLowerCase().includes("no cumple")) {
            statusTexto = "No Cumple / Fail";
            compBadgeStyle = "background-color: #E60404; color: #FFFFFF; border: 1px solid #E60404;";
        } else if (detalles.toLowerCase().includes("cumple")) {
            statusTexto = "Cumple / Pass";
        }

        var celdaEvidencia = "";
        if (notaLimpia) { 
          var notaLimpiaEn = traducirTexto(notaLimpia);
          var textoNotaBilingue = notaLimpia + (notaLimpiaEn ? " <br><i style='color:#718096;'>(" + notaLimpiaEn + ")</i>" : "");
          celdaEvidencia += "<div style='font-size:11px; margin-bottom:4px;'>" + textoNotaBilingue + "</div>"; 
        }

        for (var u = 0; u < urlsFotos.length; u++) {
            var urlF = urlsFotos[u];
            var matchId = urlF.match(/id=([^&]+)/) || urlF.match(/\/d\/([^/]+)/);
            if (matchId && matchId[1]) {
                try {
                    var fileF = DriveApp.getFileById(matchId[1]);
                    celdaEvidencia += "<div style='margin-top:4px; display:inline-block; margin-right:6px;'><img src='data:" + fileF.getMimeType() + ";base64," + Utilities.base64Encode(fileF.getBlob().getBytes()) + "' style='max-height:105px; border:1px solid #CBD5E0; border-radius:4px;' /></div>";
                } catch(err) {
                    celdaEvidencia += "<div style='margin-top:4px; display:inline-block; margin-right:6px;'><a href='" + urlF + "' target='_blank' style='font-size:10px; color:#E60404; font-weight:bold;'>Ver Foto ↗</a></div>";
                }
            }
        }
        
        var transHeader = diccionarioBilingue[pieza];
        var headerFinal = transHeader ? (pieza + " / " + transHeader) : pieza;

        htmlFilasComponentes += "<tr>" +
          "<td style='padding:6px 10px; font-size:11px; border-bottom:1px solid #E2E8F0; color:#2D3748; font-weight:600;'>" + headerFinal + "</td>" +
          "<td style='padding:6px 25px; font-size:11px; border-bottom:1px solid #E2E8F0; text-align:center;'><span style='display:inline-block; padding:2px 8px; font-weight:700; border-radius:4px; font-size:9px; text-transform:uppercase; " + compBadgeStyle + "'>" + statusTexto + "</span></td>" +
          "<td style='padding:6px 10px 6px 35px; font-size:11px; border-bottom:1px solid #E2E8F0; background-color:#fafafa;'>" + celdaEvidencia + "</td></tr>";
      }

      var dispValInd = fila[7] ? fila[7].toString().trim() : "No Evaluado";
      var indDispBadgeStyle = "border: 1px solid #393D42; color: #393D42;";
      var indDispBilingue = dispValInd;
      if (dispValInd.toLowerCase().includes("desviacion") || dispValInd.toLowerCase().includes("desviación")) {
        indDispBadgeStyle = "background-color: #EF6C00; color: #FFFFFF; border: 1px solid #EF6C00;"; indDispBilingue = "Aceptado con Desviación / Accepted with Deviation";
      } else if (dispValInd.toLowerCase().includes("aceptado")) {
        indDispBadgeStyle = "background-color: #2E7D32; color: #FFFFFF; border: 1px solid #2E7D32;"; indDispBilingue = "Aceptado / Accepted";
      } else if (dispValInd.toLowerCase().includes("rechazado")) {
        indDispBadgeStyle = "background-color: #E60404; color: #FFFFFF; border: 1px solid #E60404;"; indDispBilingue = "Rechazado / Rejected";
      }

      maquinasProcesadas.push({
        correo: fila[1], serie: fila[2], contenedor: fila[3], referencia: fila[4], modelo: fila[5],
        htmlComponentes: htmlFilasComponentes, dispStyle: indDispBadgeStyle, dispBilingue: indDispBilingue,
        comentariosGenerales: fila[8] ? fila[8].toString().trim() : ""
      });
    }
  }

  var refaccionesProcesadas = [];
  if (hojaRefacciones) {
    var datosRef = hojaRefacciones.getDataRange().getValues();
    for (var r = 1; r < datosRef.length; r++) {
      var filaRef = datosRef[r];
      if (filaRef[3] && filaRef[3].toString().trim() === refBuscada) {
        refaccionesProcesadas.push({
          correo: filaRef[1], contenedor: filaRef[2], referencia: filaRef[3],
          resultados: filaRef[4] ? filaRef[4].toString().trim() : "",
          comentariosGenerales: filaRef[5] ? filaRef[5].toString().trim() : "",
          disposicion: filaRef[6] ? filaRef[6].toString().trim() : ""
        });
      }
    }
  }
  
  if (maquinasProcesadas.length === 0 && refaccionesProcesadas.length === 0) {
    SpreadsheetApp.getUi().alert("❌ No se encontraron registros de Máquinas ni Refacciones para la Referencia: " + refBuscada);
    return;
  }

  var fechaHoy = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/MM/yyyy");
  
  var htmlMaster = "<!DOCTYPE html><html><head><meta charset='utf-8'></head><body style='font-family:Arial, sans-serif; color:#393D42; background-color:#FFFFFF; line-height:1.4; margin:0; padding:0;'>" +
    "<div style='padding: 20px 25px; page-break-inside: avoid;'>" +
      "<table style='width:100%; border-collapse:collapse; margin-bottom:16px;'>" +
        "<tr><td><h1 style='font-family:\"Arial Black\", sans-serif; font-size:30px; font-weight:900; color:#E60404; margin:0;'>ASIA ROBÓTICA</h1><div style='font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:1px; margin-top:2px;'>Reporte Consolidado de Inspección — CONSOLIDATED REPORT</div></td><td style='text-align:right;'>" + imgLogoHtml + "</td></tr>" +
      "</table>" +
      "<div style='width:100%; padding:8px 10px; background-color:#F8F9FA; border-top:2px solid #393D42; border-bottom:1px solid #E2E8F0; margin-bottom:20px; font-size:10px;'>" +
        "<table style='width:100%; font-size:10px; border-collapse:collapse;'>" +
          "<tr>" +
            "<td style='width:40%; padding-bottom:4px;'><b>AUDITOR / AUDITOR:</b> <span style='text-transform:uppercase;'>Carlos Mercado</span></td>" +
            "<td style='width:30%; padding-bottom:4px;'><b>FECHA / DATE:</b> " + fechaHoy + "</td>" +

            "<td style='width:30%; padding-bottom:4px;'><b>REFERENCIA / REFERENCE:</b> <span style='color:#E60404; font-weight:bold;'>" + refBuscada + "</span></td>" +
          "</tr>" +
          "<tr>" +
            "<td><b>CONTENEDOR / CONTAINER:</b> " + contenedor + "</td>" +
            "<td><b>PROVEEDOR / SUPPLIER:</b> <span style='text-transform:uppercase;'>" + proveedor + "</span></td>" +
            "<td><b>FACTURA / INVOICE NO:</b> " + factura + "</td>" +
          "</tr>" +
        "</table>" +
      "</div>";

  if (maquinasProcesadas.length > 0) {
      var htmlFilasResumen = "";
      for (var k = 0; k < maquinasProcesadas.length; k++) {
        var maq = maquinasProcesadas[k];
        var modeloOficial = diccionarioModelos[maq.modelo.toUpperCase()] || maq.modelo;
        htmlFilasResumen += "<tr>" +
          "<td style='padding:6px; font-size:11px; border-bottom:1px solid #E2E8F0; text-align:center;'>" + maq.referencia + "</td>" +
          "<td style='padding:6px; font-size:9px; border-bottom:1px solid #E2E8F0; text-transform:uppercase;'>" + modeloOficial + "</td>" +
          "<td style='padding:6px; font-size:11px; border-bottom:1px solid #E2E8F0; text-align:center; font-weight:bold;'>" + maq.serie + "</td>" +
          "<td style='padding:6px; font-size:11px; border-bottom:1px solid #E2E8F0; text-align:center;'><span style='display:inline-block; padding:2px 8px; font-weight:700; border-radius:4px; font-size:9px; text-transform:uppercase; " + maq.dispStyle + "'>" + maq.dispBilingue + "</span></td>" +
        "</tr>";
      }
      htmlMaster += "<div style='font-size:14px; font-weight:700; text-transform:uppercase; margin-bottom:6px; padding-bottom:4px; border-bottom:2px solid #E60404;'>Resumen de Equipos / Equipment Summary</div>" +
          "<table style='width:100%; border-collapse:collapse; margin-bottom:16px;'>" +
            "<thead><tr style='background-color:#393D42; color:#FFFFFF; font-size:10px; text-transform:uppercase;'><th style='padding:6px; text-align:center; width:20%;'>REF / Box</th><th style='padding:6px; text-align:left; width:40%;'>Descripción / Description</th><th style='padding:6px; text-align:center; width:20%;'>Serie / S/N</th><th style='padding:6px; text-align:center; width:20%;'>Disposición / Provision</th></tr></thead>" +
            "<tbody>" + htmlFilasResumen + "</tbody>" +
          "</table>";
  }

  if (refaccionesProcesadas.length > 0) {
      var htmlFilasRefacciones = "";
      for(var rf = 0; rf < refaccionesProcesadas.length; rf++) {
          var rep = refaccionesProcesadas[rf];
          var partesArray = rep.resultados.split(" | ");
          
          for (var pa = 0; pa < partesArray.length; pa++) {
              var bloqueTemp = partesArray[pa].trim();
              if(!bloqueTemp) continue;

              var numParte = "N/A", descripcion = "N/A", cant = "N/A", dispItem = "N/A", estatus = "", obs = "";

              var urlsFotosRef = [];
              var matchFotoRef;
              while ((matchFotoRef = bloqueTemp.match(/\[Foto:\s*([^\]]*?)\]/))) {
                  urlsFotosRef.push(matchFotoRef[1].trim());
                  bloqueTemp = bloqueTemp.replace(matchFotoRef[0], "").trim();
              }

              var matchNota = bloqueTemp.match(/\(Nota:\s*(.*?)\)/);
              if (matchNota) { 
                  obs = matchNota[1].trim(); 
                  bloqueTemp = bloqueTemp.replace(matchNota[0], "").trim(); 
              }

              var idxCant = bloqueTemp.indexOf("[Cant:");
              var idxDisp = bloqueTemp.indexOf("[Disp:");
              var idxEndDisp = bloqueTemp.indexOf("]:");

              if (idxCant !== -1 && idxDisp !== -1 && idxEndDisp !== -1) {
                  var tituloCompleto = bloqueTemp.substring(0, idxCant).trim();
                  cant = bloqueTemp.substring(idxCant + 6, bloqueTemp.indexOf("]", idxCant)).trim();
                  dispItem = bloqueTemp.substring(idxDisp + 6, idxEndDisp).trim();
                  estatus = bloqueTemp.substring(idxEndDisp + 2).trim();

                  var idxGuion = tituloCompleto.indexOf(" - ");
                  if (idxGuion !== -1) {
                      numParte = tituloCompleto.substring(0, idxGuion).replace("NP:", "").trim();
                      descripcion = tituloCompleto.substring(idxGuion + 3).trim();
                  } else {
                      numParte = tituloCompleto.replace("NP:", "").trim();
                      descripcion = "-";
                  }
              } else {
                  descripcion = bloqueTemp;
              }

              var badgeEstatus = estatus.toLowerCase().includes("no cumple") ? "color:#E60404;" : "color:#2E7D32;";
              var estatusBilingue = estatus.toLowerCase().includes("no cumple") ? "No cumple / Fail" : "Cumple / Pass";
              
              var badgeDisp = "color:#393D42;";
              var dispBilingue = dispItem;
              if (dispItem.toLowerCase().includes("rechazado")) { badgeDisp = "color:#E60404;"; dispBilingue = "Rechazado / Rejected"; }
              else if (dispItem.toLowerCase().includes("desviacion")) { badgeDisp = "color:#EF6C00;"; dispBilingue = "Aceptado con Desviación / Accpt. w/ Deviation"; }
              else if (dispItem.toLowerCase().includes("aceptado")) { badgeDisp = "color:#2E7D32;"; dispBilingue = "Aceptado / Accepted"; }

              var obsEn = traducirTexto(obs);
              var textoObsFinal = obs + (obsEn && obs.toLowerCase() !== "sin observaciones" ? " <br><i style='color:#718096;'>(" + obsEn + ")</i>" : "");

              var htmlEvidencia = "<span style='color:#4A5568;'>" + textoObsFinal + "</span>";
              
              for (var ur = 0; ur < urlsFotosRef.length; ur++) {
                  var fUrl = urlsFotosRef[ur];
                  var matchId = fUrl.match(/id=([^&]+)/) || fUrl.match(/\/d\/([^/]+)/);
                  if (matchId && matchId[1]) {
                      try {
                          var fileF = DriveApp.getFileById(matchId[1]);
                          htmlEvidencia += "<div style='margin-top:6px; display:inline-block; margin-right:6px;'><img src='data:" + fileF.getMimeType() + ";base64," + Utilities.base64Encode(fileF.getBlob().getBytes()) + "' style='max-height:80px; border:1px solid #CBD5E0; border-radius:4px;' /></div>";
                      } catch(err) {
                          htmlEvidencia += "<div style='margin-top:6px; display:inline-block; margin-right:6px;'><a href='" + fUrl + "' target='_blank' style='color:#3182ce; font-size:9px; text-decoration:none;'>📸 Ver Evidencia</a></div>";
                      }
                  }
              }

              htmlFilasRefacciones += "<tr>" +
                  "<td style='padding:6px; font-size:9px; border-bottom:1px solid #E2E8F0; color:#2D3748; font-weight:bold;'>" + numParte + "</td>" +
                  "<td style='padding:6px; font-size:9px; border-bottom:1px solid #E2E8F0; color:#4A5568;'>" + descripcion + "</td>" +
                  "<td style='padding:6px; font-size:10px; border-bottom:1px solid #E2E8F0; text-align:center; font-weight:bold;'>" + cant + "</td>" +
                  "<td style='padding:6px; font-size:10px; border-bottom:1px solid #E2E8F0; text-align:center; font-weight:bold; " + badgeEstatus + "'>" + estatusBilingue + "</td>" +
                  "<td style='padding:6px; font-size:10px; border-bottom:1px solid #E2E8F0; text-align:center; font-weight:bold; " + badgeDisp + "'>" + dispBilingue + "</td>" +
                  "<td style='padding:6px; font-size:9px; border-bottom:1px solid #E2E8F0;'>" + htmlEvidencia + "</td>" +
              "</tr>";
          }
      }

      htmlMaster += "<div style='font-size:14px; font-weight:700; text-transform:uppercase; margin-top:25px; margin-bottom:6px; padding-bottom:4px; border-bottom:2px solid #E60404;'>COMPONENTES Y ACCESORIOS / COMPONENTS AND ACCESSORIES</div>" +
          "<table style='width:100%; border-collapse:collapse; margin-bottom:16px;'>" +
            "<thead><tr style='background-color:#393D42; color:#FFFFFF; font-size:9px; text-transform:uppercase;'>" +
              "<th style='padding:6px; text-align:left; width:15%;'>Num. Parte / Part Number</th>" +
              "<th style='padding:6px; text-align:left; width:25%;'>Descripción / Description</th>" +
              "<th style='padding:6px; text-align:center; width:8%;'>Cant / Quantity.</th>" +
              "<th style='padding:6px; text-align:center; width:12%;'>Estatus / Status</th>" +
              "<th style='padding:6px; text-align:center; width:15%;'>Disposición / Provision</th>" +
              "<th style='padding:6px; text-align:left; width:25%;'>Observaciones / Observations</th>" +
            "</tr></thead>" +
            "<tbody>" + htmlFilasRefacciones + "</tbody>" +
          "</table>";
  }

  htmlMaster += "</div>";

  for (var x = 0; x < maquinasProcesadas.length; x++) {
    var maq = maquinasProcesadas[x];
    var emailInsp = maq.correo; 
    
    var nombreComercialInd = maq.modelo.toUpperCase();
    var modeloOficialInd = diccionarioModelos[nombreComercialInd] ? diccionarioModelos[nombreComercialInd] : maq.modelo;

    var inspectorNombre = "Inspector";
    if (emailInsp) {
      var partes = emailInsp.split('@')[0].split('.');
      if (partes.length >= 2) { inspectorNombre = partes[0].charAt(0).toUpperCase() + partes[0].slice(1) + " " + partes[1].charAt(0).toUpperCase() + partes[1].slice(1); } 
      else { inspectorNombre = emailInsp.split('@')[0]; }
    }
    var imgInspectorHtml = "<div style='height:100px;'></div>";
    var idFirmaInsp = inspectores[emailInsp.toLowerCase()];
    if (idFirmaInsp) {
      try { var fI = DriveApp.getFileById(idFirmaInsp); imgInspectorHtml = "<img src='data:" + fI.getMimeType() + ";base64," + Utilities.base64Encode(fI.getBlob().getBytes()) + "' style='max-height:100px; display:block; margin:0 auto 4px auto;' />"; } catch(e){}
    }

    var comentariosGeneralesEn = traducirTexto(maq.comentariosGenerales);
    var htmlComentariosGenerales = "<span style='color:#a0aec0; font-style:italic;'>Sin comentarios generales registrados. / No general comments registered.</span>";
    if (maq.comentariosGenerales) {
      htmlComentariosGenerales = maq.comentariosGenerales + (comentariosGeneralesEn ? "<br><span style='color:#718096; font-style:italic; display:block; margin-top:4px;'>(" + comentariosGeneralesEn + ")</span>" : "");
    }

    htmlMaster += "<div style='page-break-before: always; padding: 20px 25px;'>" +
      "<table style='width:100%; border-collapse:collapse; margin-bottom:16px;'>" +
        "<tr><td><h1 style='font-family:\"Arial Black\", sans-serif; font-size:30px; font-weight:900; color:#E60404; margin:0;'>ASIA ROBÓTICA</h1><div style='font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:1px; margin-top:2px;'>Reporte de Control de Calidad — INCOMING</div></td><td style='text-align:right;'>" + imgLogoHtml + "</td></tr>" +
      "</table>" +
      "<div style='width:100%; padding:8px 10px; background-color:#F8F9FA; border-top:2px solid #393D42; border-bottom:1px solid #E2E8F0; margin-bottom:12px; font-size:10px;'>" +
        "<div style='margin-bottom:6px;'><b>MÁQUINA/MODELO / MACHINE/MODEL:</b> <span style='color:#E60404; font-weight:bold;'>" + modeloOficialInd + " / " + maq.modelo + "</span></div>" +
        "<table style='width:100%; font-size:10px; border-collapse:collapse;'>" +
          "<tr>" +
            "<td style='width:40%; padding-bottom:4px;'><b>NÚMERO SERIE / SERIAL NUMBER:</b> " + maq.serie + "</td>" +
            "<td style='width:30%; padding-bottom:4px;'><b>FECHA / DATE:</b> " + fechaHoy + "</td>" +
            "<td style='width:30%; padding-bottom:4px;'><b>CONTENEDOR / CONTAINER:</b> " + maq.contenedor + "</td>" +
          "</tr>" +
          "<tr>" +
            "<td><b>REFERENCIA / REFERENCE:</b> " + maq.referencia + "</td>" +
            "<td colspan='2'><b>INSPECTOR / INSPECTOR:</b> " + emailInsp + "</td>" +
          "</tr>" +
        "</table>" +
      "</div>" +
      "<div style='font-size:15px; font-weight:700; text-transform:uppercase; margin:12px 0 6px 0; padding-bottom:4px; border-bottom:2px solid #E60404;'>1. Evaluación de Componentes / Components Evaluation</div>" +
      "<table style='width:100%; border-collapse:collapse; margin-bottom:16px;'>" +
        "<thead><tr style='background-color:#393D42; color:#FFFFFF; font-size:10px; text-transform:uppercase;'><th style='padding:6px 10px; text-align:left; width:35%;'>Componente Evaluado / Evaluated Component</th><th style='padding:6px 10px; text-align:center; width:20%;'>Estatus / Status</th><th style='padding:6px 10px 6px 35px; text-align:left; width:45%;'>Notas y Evidencias / Notes & Photos</th></tr></thead>" +
        "<tbody>" + maq.htmlComponentes + "</tbody>" +
      "</table>" +
      "<div style='margin:16px 0; padding:10px; background-color:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; font-size:12px; font-weight:bold; color:#393D42; text-align:right;'>DISPOSICIÓN FINAL | FINAL DISPOSITION: <span style='display:inline-block; padding:4px 12px; font-weight:700; border-radius:4px; font-size:11px; text-transform:uppercase; " + maq.dispStyle + "'>" + maq.dispBilingue + "</span></div>" +
      "<div style='font-size:14px; font-weight:700; text-transform:uppercase; margin:16px 0 6px 0; padding-bottom:4px; border-bottom:2px solid #393D42;'>2. Comentarios Generales del Equipo / General Machine Comments</div>" +
      "<div style='background-color:#F8F9FA; border-left:4px solid #E60404; padding:10px; font-size:11px; color:#2D3748; min-height:25px; margin-bottom:16px;'>" + 
        htmlComentariosGenerales + 
      "</div>" +
      "<div style='margin-top:40px; padding-top:20px; page-break-inside: avoid; border-top: 2px dashed #E2E8F0;'>" +
        "<table style='width:100%; border-collapse:collapse;'>" +
          "<tr>" +
            "<td style='width:50%; text-align:center; vertical-align:bottom; padding:0 30px;'>" + imgInspectorHtml + "<div style='width:100%; border-top:1px solid #393D42; margin-bottom:4px;'></div><div style='font-size:11px; font-weight:700; text-transform:uppercase;'>" + inspectorNombre + "</div><div style='font-size:9px; color:#718096;'>Inspector de Calidad / Quality Inspector</div></td>" +
            "<td style='width:50%; text-align:center; vertical-align:bottom; padding:0 30px;'>" + imgJefeHtml + "<div style='width:100%; border-top:1px solid #393D42; margin-bottom:4px;'></div><div style='font-size:11px; font-weight:700; color:#1A202C; text-transform:uppercase;'>Carlos Mercado</div><div style='font-size:9px; color:#718096;'>Autorización / Authorized Signature</div></td>" +
          "</tr>" +
        "</table>" +
      "</div>" +
    "</div>";
  }

  htmlMaster += "</body></html>";

  var finalBlob = Utilities.newBlob(htmlMaster, "text/html", "Temporal.html").getAs(MimeType.PDF);
  finalBlob.setName("REPORTE_COMPLETO_" + refBuscada + ".pdf");
  
  var idCarpetaConsolidados = " ";
  var carpetaDestino = DriveApp.getFolderById(idCarpetaConsolidados);
  carpetaDestino.createFile(finalBlob);

  SpreadsheetApp.getUi().alert(" ¡Reporte creado con éxito!");
}


function generarReporteIndividualAutomatico(datosForm) {
  try {
    var libro = SpreadsheetApp.getActiveSpreadsheet();
    var hojaMaquinas = libro.getSheetByName("BaseMaquinas");
    var datosMaq = hojaMaquinas.getDataRange().getValues();
    
    var diccionarioModelos = {};
    var diccionarioBilingue = {};

    for (var m = 1; m < datosMaq.length; m++) {
      var maqCorto = datosMaq[m][0] ? datosMaq[m][0].toString().trim().toUpperCase() : "";
      var maqTecnico = datosMaq[m][1] ? datosMaq[m][1].toString().trim() : "";
      var piezaEsp = datosMaq[m][2] ? datosMaq[m][2].toString().trim() : "";
      var piezaIng = datosMaq[m][3] ? datosMaq[m][3].toString().trim() : "";
      
      if (maqCorto) { diccionarioModelos[maqCorto] = maqTecnico ? maqTecnico : maqCorto; }
      if (piezaEsp && piezaIng) { diccionarioBilingue[piezaEsp] = piezaIng; }
    }

    var idLogoDrive = " "; 
    var idFirmaJefe = " "; 
    var inspectores = {
      " ": " ",
    };

    var imgLogoHtml = ""; try { var fL = DriveApp.getFileById(idLogoDrive); imgLogoHtml = "<img src='data:" + fL.getMimeType() + ";base64," + Utilities.base64Encode(fL.getBlob().getBytes()) + "' style='max-height:40px;' />"; } catch(e){}
    var imgJefeHtml = "<div style='height:100px;'></div>"; try { var fJ = DriveApp.getFileById(idFirmaJefe); imgJefeHtml = "<img src='data:" + fJ.getMimeType() + ";base64," + Utilities.base64Encode(fJ.getBlob().getBytes()) + "' style='max-height:100px; display:block; margin:0 auto 4px auto;' />"; } catch(e){}

    var nombreComercialInd = datosForm.nombreMaquina.toUpperCase();
    var modeloOficialInd = diccionarioModelos[nombreComercialInd] ? diccionarioModelos[nombreComercialInd] : datosForm.nombreMaquina;
    var fechaHoy = datosForm.fechaReporte || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/MM/yyyy");

    var htmlFilasComponentes = "";
    if (datosForm.evaluaciones.length === 0) {
      htmlFilasComponentes = "<tr><td colspan='3' style='padding:10px; font-size:11px; color:#718096;'>Sin evaluaciones registradas para esta serie.</td></tr>";
    }
    for (var p = 0; p < datosForm.evaluaciones.length; p++) {
      var evaluacion = datosForm.evaluaciones[p];
      var statusTexto = evaluacion.seleccion === "Cumple" ? "Cumple / Pass" : "No Cumple / Fail";
      var compBadgeStyle = evaluacion.seleccion === "Cumple" ? "border: 1px solid #393D42; color: #393D42;" : "background-color: #E60404; color: #FFFFFF; border: 1px solid #E60404;";

      var celdaEvidencia = "";
      if (evaluacion.comentario) { 
        var comentarioEn = traducirTexto(evaluacion.comentario);
        var textoEvBilingue = evaluacion.comentario + (comentarioEn ? " <br><i style='color:#718096;'>(" + comentarioEn + ")</i>" : "");
        celdaEvidencia += "<div style='font-size:11px; margin-bottom:4px;'>" + textoEvBilingue + "</div>"; 
      }
      
      if (evaluacion.fotos && evaluacion.fotos.length > 0) {
        for (var f = 0; f < evaluacion.fotos.length; f++) {
          var urlDirecta = evaluacion.fotos[f].urlDirecta; 
          if (urlDirecta) {
            var matchId = urlDirecta.match(/id=([^&]+)/) || urlDirecta.match(/\/d\/([^/]+)/);
            if (matchId && matchId[1]) {
              try {
                var fileF = DriveApp.getFileById(matchId[1]);
                celdaEvidencia += "<div style='margin-top:4px; display:inline-block; margin-right:6px;'><img src='data:" + fileF.getMimeType() + ";base64," + Utilities.base64Encode(fileF.getBlob().getBytes()) + "' style='max-height:105px; border:1px solid #CBD5E0; border-radius:4px;' /></div>";
              } catch(err) {
                celdaEvidencia += "<div style='margin-top:4px; display:inline-block; margin-right:6px;'><a href='" + urlDirecta + "' target='_blank' style='font-size:10px; color:#E60404; font-weight:bold;'>Ver Foto ↗</a></div>";
              }
            }
          }
        }
      }

      var transHeader = diccionarioBilingue[evaluacion.pieza];
      var headerFinal = transHeader ? (evaluacion.pieza + " / " + transHeader) : evaluacion.pieza;

      htmlFilasComponentes += "<tr>" +
        "<td style='padding:6px 10px; font-size:11px; border-bottom:1px solid #E2E8F0; color:#2D3748; font-weight:600;'>" + headerFinal + "</td>" +
        "<td style='padding:6px 25px; font-size:11px; border-bottom:1px solid #E2E8F0; text-align:center;'><span style='display:inline-block; padding:2px 8px; font-weight:700; border-radius:4px; font-size:9px; text-transform:uppercase; " + compBadgeStyle + "'>" + statusTexto + "</span></td>" +
        "<td style='padding:6px 10px 6px 35px; font-size:11px; border-bottom:1px solid #E2E8F0; background-color:#fafafa;'>" + celdaEvidencia + "</td>" +
      "</tr>";
    }

    var dispValInd = datosForm.disposicion;
    var indDispBadgeStyle = "border: 1px solid #393D42; color: #393D42;";
    var indDispBilingue = dispValInd;
    if (dispValInd.toLowerCase().includes("desviacion") || dispValInd.toLowerCase().includes("desviación")) {
      indDispBadgeStyle = "background-color: #EF6C00; color: #FFFFFF; border: 1px solid #EF6C00;"; indDispBilingue = "Aceptado con Desviación / Accepted with Deviation";
    } else if (dispValInd.toLowerCase().includes("aceptado")) {
      indDispBadgeStyle = "background-color: #2E7D32; color: #FFFFFF; border: 1px solid #2E7D32;"; indDispBilingue = "Aceptado / Accepted";
    } else if (dispValInd.toLowerCase().includes("rechazado")) {
      indDispBadgeStyle = "background-color: #E60404; color: #FFFFFF; border: 1px solid #E60404;"; indDispBilingue = "Rechazado / Rejected";
    }

    var emailInsp = datosForm.correo;
    var inspectorNombre = "Inspector";
    if (emailInsp) {
      var partes = emailInsp.split('@')[0].split('.');
      if (partes.length >= 2) { inspectorNombre = partes[0].charAt(0).toUpperCase() + partes[0].slice(1) + " " + partes[1].charAt(0).toUpperCase() + partes[1].slice(1); } 
      else { inspectorNombre = emailInsp.split('@')[0]; }
    }
    var imgInspectorHtml = "<div style='height:100px;'></div>";
    var idFirmaInsp = inspectores[emailInsp.toLowerCase()];
    if (idFirmaInsp) {
      try { var fI = DriveApp.getFileById(idFirmaInsp); imgInspectorHtml = "<img src='data:" + fI.getMimeType() + ";base64," + Utilities.base64Encode(fI.getBlob().getBytes()) + "' style='max-height:100px; display:block; margin:0 auto 4px auto;' />"; } catch(e){}
    }

    var comentariosGeneralesEnForm = traducirTexto(datosForm.comentariosGenerales);
    var htmlComentariosGeneralesForm = "<span style='color:#a0aec0; font-style:italic;'>Sin comentarios generales registrados. / No general comments registered.</span>";
    if (datosForm.comentariosGenerales) {
      htmlComentariosGeneralesForm = datosForm.comentariosGenerales + (comentariosGeneralesEnForm ? "<br><span style='color:#4A5568; font-style:italic; display:block; margin-top:4px;'><b>Translation:</b> " + comentariosGeneralesEnForm + "</span>" : "");
    }

    var htmlMaster = "<!DOCTYPE html><html><head><meta charset='utf-8'></head><body style='font-family:Arial, sans-serif; color:#393D42; background-color:#FFFFFF; line-height:1.4; margin:0; padding:0;'>" +
      "<div style='padding: 20px 25px;'>" +
        "<table style='width:100%; border-collapse:collapse; margin-bottom:16px;'>" +
          "<tr><td><h1 style='font-family:\"Arial Black\", sans-serif; font-size:30px; font-weight:900; color:#E60404; margin:0;'>ASIA ROBÓTICA</h1><div style='font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:1px; margin-top:2px;'>Reporte de Control de Calidad — INCOMING</div></td><td style='text-align:right;'>" + imgLogoHtml + "</td></tr>" +
        "</table>" +
        "<div style='width:100%; padding:8px 10px; background-color:#F8F9FA; border-top:2px solid #393D42; border-bottom:1px solid #E2E8F0; margin-bottom:12px; font-size:10px;'>" +
          "<div style='margin-bottom:6px;'><b>MÁQUINA/MODELO / MACHINE/MODEL:</b> <span style='color:#E60404; font-weight:bold;'>" + modeloOficialInd + " / " + datosForm.nombreMaquina + "</span></div>" +
          "<table style='width:100%; font-size:10px; border-collapse:collapse;'>" +
            "<tr>" +
              "<td style='width:40%; padding-bottom:4px;'><b>NÚMERO SERIE / SERIAL NUMBER:</b> " + datosForm.serie + "</td>" +
              "<td style='width:30%; padding-bottom:4px;'><b>FECHA / DATE:</b> " + fechaHoy + "</td>" +
              "<td style='width:30%; padding-bottom:4px;'><b>CONTENEDOR / CONTAINER:</b> " + datosForm.contenedor + "</td>" +
            "</tr>" +
            "<tr>" +
              "<td><b>REFERENCIA / REFERENCE:</b> " + datosForm.referencia + "</td>" +
              "<td colspan='2'><b>INSPECTOR / INSPECTOR:</b> " + emailInsp + "</td>" +
            "</tr>" +
          "</table>" +
        "</div>" +
        
        "<div style='font-size:15px; font-weight:700; text-transform:uppercase; margin:12px 0 6px 0; padding-bottom:4px; border-bottom:2px solid #E60404;'>1. Evaluación de Componentes / Components Evaluation</div>" +
        "<table style='width:100%; border-collapse:collapse; margin-bottom:16px;'>" +
          "<thead><tr style='background-color:#393D42; color:#FFFFFF; font-size:10px; text-transform:uppercase;'><th style='padding:6px 10px; text-align:left; width:35%;'>Componente Evaluado / Evaluated Component</th><th style='padding:6px 10px; text-align:center; width:20%;'>Estatus / Status</th><th style='padding:6px 10px 6px 35px; text-align:left; width:45%;'>Notas y Evidencias / Notes & Photos</th></tr></thead>" +
          "<tbody>" + htmlFilasComponentes + "</tbody>" +
        "</table>" +
        
        "<div style='margin:16px 0; padding:10px; background-color:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; font-size:12px; font-weight:bold; color:#393D42; text-align:right;'>DISPOSICIÓN FINAL | FINAL DISPOSITION: <span style='display:inline-block; padding:4px 12px; font-weight:700; border-radius:4px; font-size:11px; text-transform:uppercase; " + indDispBadgeStyle + "'>" + indDispBilingue + "</span></div>" +
        
        "<div style='font-size:14px; font-weight:700; text-transform:uppercase; margin:16px 0 6px 0; padding-bottom:4px; border-bottom:2px solid #393D42;'>2. Comentarios Generales del Equipo / General Machine Comments</div>" +
        "<div style='background-color:#F8F9FA; border-left:4px solid #E60404; padding:10px; font-size:11px; color:#2D3748; min-height:25px; margin-bottom:16px;'>" + 
          htmlComentariosGeneralesForm + 
        "</div>" +
        "<div style='margin-top:40px; padding-top:20px; page-break-inside: avoid; border-top: 2px dashed #E2E8F0;'>" +
          "<table style='width:100%; border-collapse:collapse;'>" +
            "<tr>" +
              "<td style='width:50%; text-align:center; vertical-align:bottom; padding:0 30px;'>" + imgInspectorHtml + "<div style='width:100%; border-top:1px solid #393D42; margin-bottom:4px;'></div><div style='font-size:11px; font-weight:700; text-transform:uppercase;'>" + inspectorNombre + "</div><div style='font-size:9px; color:#718096;'>Inspector de Calidad / Quality Inspector</div></td>" +
              "<td style='width:50%; text-align:center; vertical-align:bottom; padding:0 30px;'>" + imgJefeHtml + "<div style='width:100%; border-top:1px solid #393D42; margin-bottom:4px;'></div><div style='font-size:11px; font-weight:700; color:#1A202C; text-transform:uppercase;'>Carlos Mercado</div><div style='font-size:9px; color:#718096;'>Autorización / Authorized Signature</div></td>" +
            "</tr>" +
          "</table>" +
        "</div>" +
      "</div></body></html>";

    var finalBlob = Utilities.newBlob(htmlMaster, "text/html", "TempInd.html").getAs(MimeType.PDF);
    
    var nombreArchivo = datosForm.referencia + "_" + datosForm.nombreMaquina + "_" + datosForm.serie + ".pdf";
    finalBlob.setName(nombreArchivo);
    
    var idUnidadCompartida = " ";
    var unidadCompartida = DriveApp.getFolderById(idUnidadCompartida);
    var carpetasReportes = unidadCompartida.getFoldersByName("Reportes Incoming");
    var carpetaDestino = carpetasReportes.hasNext()
      ? carpetasReportes.next()
      : unidadCompartida.createFolder("Reportes Incoming");
    var archivoReporte = carpetaDestino.createFile(finalBlob);
    return archivoReporte.getUrl();
    
  } catch(e) {
    Logger.log("Error en PDF automático: " + e.toString());
    return "";
  }
}

function reconstruirEvaluacionesParaReporte(textoGuardado) {
  if (!String(textoGuardado || '').trim()) return [];

  return String(textoGuardado).split(' | ').map(function(bloque) {
    var separador = bloque.search(/:\s*(?:No cumple|Cumple)\b/i);
    if (separador < 1) {
      throw new Error('No se pudo interpretar una evaluación guardada en Respuestas G.');
    }

    var pieza = bloque.substring(0, separador).trim();
    var detalles = bloque.substring(separador + 1).trim();
    var fotos = [];
    detalles = detalles.replace(/\[Foto:\s*([^\]]+)\]/g, function(_, url) {
      fotos.push({ urlDirecta: url.trim() });
      return '';
    });

    var comentario = '';
    detalles = detalles.replace(/\(Nota:\s*(.*?)\)/, function(_, nota) {
      comentario = nota.trim();
      return '';
    });

    var estado = detalles.trim().toLowerCase();
    if (estado !== 'cumple' && estado !== 'no cumple') {
      throw new Error('La evaluación de ' + pieza + ' tiene un estado no reconocido.');
    }
    return {
      pieza: pieza,
      seleccion: estado === 'cumple' ? 'Cumple' : 'No cumple',
      comentario: comentario,
      fotos: fotos
    };
  });
}

function generarReporteIndividualPorSerie() {
  var ui = SpreadsheetApp.getUi();
  var respuesta = ui.prompt(
    'Reporte individual',
    'Escribe el número de serie interno:',
    ui.ButtonSet.OK_CANCEL
  );
  if (respuesta.getSelectedButton() !== ui.Button.OK) return;

  var serie = String(respuesta.getResponseText() || '').trim();
  if (!serie) {
    ui.alert('Escribe un número de serie interno.');
    return;
  }

  try {
    var libro = SpreadsheetApp.getActiveSpreadsheet();
    var hojaRespuestas = libro.getSheetByName('Respuestas');
    if (!hojaRespuestas) throw new Error('No se encontró la pestaña Respuestas.');

    var filasIncoming = buscarFilasDeSerie(hojaRespuestas, 3, serie);
    if (filasIncoming.length === 0) {
      throw new Error('No se encontró una inspección Incoming para esa serie.');
    }
    var filaIncoming = Math.max.apply(null, filasIncoming);
    var registro = hojaRespuestas.getRange(filaIncoming, 1, 1, 10).getDisplayValues()[0];
    if (!String(registro[5] || '').trim()) {
      throw new Error('El registro no tiene modelo de máquina en Respuestas F.');
    }

    var hojaBitacora = SpreadsheetApp.openById(' ')
      .getSheetByName('Bitácora');
    if (!hojaBitacora) throw new Error('No se encontró la pestaña Bitácora.');
    var filasBitacora = buscarFilasDeSerie(hojaBitacora, 5, serie);
    if (filasBitacora.length === 0) {
      throw new Error('La serie no existe en Bitácora E; no se creó el PDF sin una fila para enlazar.');
    }

    var referencia = String(registro[4] || '').trim();
    var filasMismaReferencia = filasBitacora.filter(function(fila) {
      return String(hojaBitacora.getRange(fila, 3).getDisplayValue() || '').trim().toUpperCase() ===
        referencia.toUpperCase();
    });
    var filasDestino = filasMismaReferencia.length > 0
      ? filasMismaReferencia
      : (filasBitacora.length === 1 ? filasBitacora : []);
    if (filasDestino.length === 0) {
      throw new Error('Hay varias filas con esa serie en Bitácora y ninguna coincide con la referencia. Revisa las filas antes de generar el PDF.');
    }

    var datosReporte = {
      fechaReporte: registro[0],
      correo: registro[1],
      serie: String(registro[2] || '').trim(),
      contenedor: registro[3],
      referencia: referencia,
      nombreMaquina: registro[5],
      evaluaciones: reconstruirEvaluacionesParaReporte(registro[6]),
      disposicion: registro[7],
      comentariosGenerales: registro[8]
    };
    var urlReporte = generarReporteIndividualAutomatico(datosReporte);
    if (!urlReporte) throw new Error('No se pudo generar el PDF. Revisa las ejecuciones de Apps Script.');

    var bloqueo = LockService.getScriptLock();
    if (!bloqueo.tryLock(10000)) {
      throw new Error('El PDF se creó, pero Bitácora está ocupada. Enlace pendiente: ' + urlReporte);
    }
    try {
      filasDestino.forEach(function(fila) {
        var serieEnFila = String(hojaBitacora.getRange(fila, 5).getDisplayValue() || '').trim();
        if (serieEnFila.toUpperCase() !== serie.toUpperCase()) {
          throw new Error('La serie cambió en la fila ' + fila + '. PDF creado sin enlace: ' + urlReporte);
        }
        hojaBitacora.getRange(fila, 3).setRichTextValue(
          SpreadsheetApp.newRichTextValue()
            .setText(referencia || 'Abrir reporte')
            .setLinkUrl(urlReporte)
            .build()
        );
      });
    } finally {
      if (bloqueo.hasLock()) bloqueo.releaseLock();
    }
    var avisoEvaluaciones = datosReporte.evaluaciones.length === 0
      ? ' El registro no tenía evaluaciones; el PDF lo indica.'
      : '';
    ui.alert('Reporte individual creado y enlazado en Bitácora.' + avisoEvaluaciones);
  } catch (error) {
    Logger.log('Error creando el reporte individual manual: ' + error.toString());
    ui.alert('No se pudo completar el reporte individual: ' + error.message);
  }
}

function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('Generar reportes')
    .addItem('Reporte completo por referencia', 'generarReporteConsolidado')
    .addItem('Reporte individual por serie', 'generarReporteIndividualPorSerie')
    .addToUi();
}

function generarReporteReclamacionPDF(datos) {
  try {
    var idLogoDrive = " "; 
    var idFirmaJefe = " ";
    
    var inspectores = {
      " ": " ",
       
    };

    var imgLogoHtml = ""; try { var fL = DriveApp.getFileById(idLogoDrive); imgLogoHtml = "<img src='data:" + fL.getMimeType() + ";base64," + Utilities.base64Encode(fL.getBlob().getBytes()) + "' style='max-height:40px;' />"; } catch(e){}
    var imgJefeHtml = "<div style='height:100px;'></div>"; try { var fJ = DriveApp.getFileById(idFirmaJefe); imgJefeHtml = "<img src='data:" + fJ.getMimeType() + ";base64," + Utilities.base64Encode(fJ.getBlob().getBytes()) + "' style='max-height:100px; display:block; margin:0 auto 4px auto;' />"; } catch(e){}

    var emailInsp = datos.correo;
    var inspectorNombre = "Inspector";
    if (emailInsp) {
      var partes = emailInsp.split('@')[0].split('.');
      if (partes.length >= 2) { inspectorNombre = partes[0].charAt(0).toUpperCase() + partes[0].slice(1) + " " + partes[1].charAt(0).toUpperCase() + partes[1].slice(1); } 
      else { inspectorNombre = emailInsp.split('@')[0]; }
    }
    var imgInspectorHtml = "<div style='height:100px;'></div>";
    var idFirmaInsp = inspectores[emailInsp.toLowerCase()];
    if (idFirmaInsp) {
      try { var fI = DriveApp.getFileById(idFirmaInsp); imgInspectorHtml = "<img src='data:" + fI.getMimeType() + ";base64," + Utilities.base64Encode(fI.getBlob().getBytes()) + "' style='max-height:100px; display:block; margin:0 auto 4px auto;' />"; } catch(e){}
    }

    var fechaHoy = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/MM/yyyy");

    var defEn = traducirTexto(datos.defecto);
    var justEn = traducirTexto(datos.justificacion);
    var etapaEn = traducirTexto(datos.etapa);
    var sevEn = traducirTexto(datos.clSeveridad);
    var reinEn = traducirTexto(datos.clReincidencia);
    var impEn = traducirTexto(datos.clImpacto);

    var htmlFotos = "";
    if (datos.fotos && datos.fotos.length > 0) {
      for (var f = 0; f < datos.fotos.length; f++) {
        var urlD = datos.fotos[f].urlDirecta;
        if (urlD) {
          var matchId = urlD.match(/id=([^&]+)/) || urlD.match(/\/d\/([^/]+)/);
          if (matchId && matchId[1]) {
            try {
              var filePhoto = DriveApp.getFileById(matchId[1]);
              htmlFotos += "<img src='data:" + filePhoto.getMimeType() + ";base64," + Utilities.base64Encode(filePhoto.getBlob().getBytes()) + "' style='max-height:180px; margin-right:10px; margin-bottom:10px; border:1px solid #CBD5E0; border-radius:4px;' />";
            } catch(e) {}
          }
        }
      }
    } else {
      htmlFotos = "<i style='color:#718096; font-size:11px;'>Sin evidencia fotográfica / No photographic evidence provided.</i>";
    }

    var htmlReq = "<ul style='margin:0; padding-left:20px;'>";
    if(datos.reqAcuse) htmlReq += "<li><b>Acuse y reconocimiento escrito</b> / <i>Written acknowledgment</i></li>";
    if(datos.reqReposicion) htmlReq += "<li><b>Reposición del componente sin costo</b> / <i>Component replacement at no cost</i></li>";
    if(datos.reqCompensacion) htmlReq += "<li><b>Compensación económica</b> / <i>Financial compensation (Credit Note)</i></li>";
    if(datos.reqRevision) htmlReq += "<li><b>Revisión e inspección adicional de lote activo</b> / <i>Additional inspection of active batch</i></li>";
    htmlReq += "</ul>";
    if(htmlReq === "<ul style='margin:0; padding-left:20px;'></ul>") htmlReq = "Ninguno / None";

    var htmlMaster = "<!DOCTYPE html><html><head><meta charset='utf-8'></head><body style='font-family:Arial, sans-serif; color:#2D3748; background-color:#FFFFFF; line-height:1.4; margin:0; padding:0;'>" +
      "<div style='padding: 20px 25px;'>" +
        "<table style='width:100%; border-collapse:collapse; margin-bottom:16px;'>" +
          "<tr><td><h1 style='font-family:\"Arial Black\", sans-serif; font-size:26px; font-weight:900; color:#E60404; margin:0;'>ASIA ROBÓTICA</h1><div style='font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:1px; margin-top:2px; color:#393D42;'>REPORTE DE NO CONFORMIDAD (NCR) <br><span style='color:#718096;'>NON-CONFORMANCE REPORT (SCAR)</span></div></td><td style='text-align:right;'>" + imgLogoHtml + "</td></tr>" +
        "</table>" +

        "<div style='width:100%; padding:10px; background-color:#F8F9FA; border-top:3px solid #E60404; border-bottom:1px solid #E2E8F0; margin-bottom:15px; font-size:11px;'>" +
          "<table style='width:100%; border-collapse:collapse;'>" +
            "<tr>" +
              "<td colspan='2' style='padding-bottom:6px;'><b>MÁQUINA / MACHINE:</b> <span style='color:#E60404; font-weight:bold; font-size:12px; text-transform:uppercase;'>" + datos.modelo + "</span></td>" +
            "</tr>" +
            "<tr>" +
              "<td style='width:50%; padding-bottom:6px;'><b>SERIE / S/N:</b> <span style='font-weight:bold;'>" + datos.serie + "</span></td>" +
              "<td style='width:50%; padding-bottom:6px;'><b>FECHA / DATE:</b> " + fechaHoy + "</td>" +
            "</tr>" +


            "<tr>" +
              "<td style='padding-bottom:6px;'><b>REFERENCIA / REF:</b> " + datos.referencia + "</td>" +
              "<td style='padding-bottom:6px;'><b>CONTENEDOR / CONTAINER:</b> " + datos.contenedor + "</td>" +
            "</tr>" +
            "<tr>" +
              "<td colspan='2'><b>AUDITOR:</b> <span style='text-transform:uppercase;'>" + inspectorNombre + "</span></td>" +
            "</tr>" +
          "</table>" +
        "</div>" +

        "<h3 style='font-size:13px; font-weight:bold; color:#E60404; border-bottom:2px solid #E2E8F0; padding-bottom:4px; margin-bottom:8px; text-transform:uppercase;'>1. Detalles del Incidente / Incident Details</h3>" +
        "<table style='width:100%; border-collapse:collapse; font-size:11px; margin-bottom:15px; border: 1px solid #E2E8F0;'>" +
          "<tr><td style='background:#F1F5F9; padding:8px; width:35%; font-weight:bold;'>Descripción del Defecto<br><i style='color:#718096; font-weight:normal;'>Defect Description</i></td><td style='padding:8px; border-left:1px solid #E2E8F0;'>" + datos.defecto + "<br><i style='color:#718096; margin-top:4px; display:block;'>" + defEn + "</i></td></tr>" +
          "<tr style='border-top:1px solid #E2E8F0;'><td style='background:#F1F5F9; padding:8px; font-weight:bold;'>Etapa de Detección<br><i style='color:#718096; font-weight:normal;'>Detection Stage</i></td><td style='padding:8px; border-left:1px solid #E2E8F0;'>" + datos.etapa + "<br><i style='color:#718096; margin-top:2px; display:block;'>" + etapaEn + "</i></td></tr>" +
          "<tr style='border-top:1px solid #E2E8F0;'><td style='background:#F1F5F9; padding:8px; font-weight:bold;'>Justificación Detección Tardía<br><i style='color:#718096; font-weight:normal;'>Late Detection Justification</i></td><td style='padding:8px; border-left:1px solid #E2E8F0;'>" + datos.justificacion + "<br><i style='color:#718096; margin-top:4px; display:block;'>" + justEn + "</i></td></tr>" +
        "</table>" +

        "<h3 style='font-size:13px; font-weight:bold; color:#E60404; border-bottom:2px solid #E2E8F0; padding-bottom:4px; margin-bottom:8px; text-transform:uppercase;'>2. Evidencia Objetiva / Objective Evidence</h3>" +
        "<div style='background-color:#F8F9FA; padding:10px; border:1px solid #E2E8F0; text-align:center; margin-bottom:15px;'>" + htmlFotos + "</div>" +

        "<h3 style='font-size:13px; font-weight:bold; color:#E60404; border-bottom:2px solid #E2E8F0; padding-bottom:4px; margin-bottom:8px; text-transform:uppercase;'>3. Impacto Operativo y Económico / Operational & Economic Impact</h3>" +
        "<table style='width:100%; border-collapse:collapse; font-size:11px; margin-bottom:15px; border: 1px solid #E2E8F0;'>" +
          "<tr><td style='padding:8px; width:50%; border-bottom:1px solid #E2E8F0; border-right:1px solid #E2E8F0;'><b>Total Horas Técnico Invertidas / Total Tech Hours Invested:</b><br><span style='font-size:14px; font-weight:bold; color:#393D42;'>" + datos.cHoras + " hrs</span></td><td style='padding:8px; width:50%; border-bottom:1px solid #E2E8F0;'><b>Costo Estimado del Incidente / Estimated Total Cost:</b><br><span style='font-size:14px; font-weight:bold; color:#E60404;'>$" + datos.cCosto + "</span></td></tr>" +
        "</table>" +

        "<h3 style='font-size:13px; font-weight:bold; color:#E60404; border-bottom:2px solid #E2E8F0; padding-bottom:4px; margin-bottom:8px; text-transform:uppercase;'>4. Requerimientos al Proveedor / Requirements from Supplier</h3>" +
        "<div style='font-size:11px; margin-bottom:15px; padding:10px; border:1px solid #E2E8F0; background:#F8F9FA;'>" + htmlReq + "</div>" +

        "<h3 style='font-size:13px; font-weight:bold; color:#E60404; border-bottom:2px solid #E2E8F0; padding-bottom:4px; margin-bottom:8px; text-transform:uppercase;'>5. Clasificación / Classification</h3>" +
        "<table style='width:100%; border-collapse:collapse; font-size:11px; margin-bottom:20px; border: 1px solid #E2E8F0; text-align:center;'>" +
          "<tr style='background:#F1F5F9; font-weight:bold;'><td style='padding:6px; border-right:1px solid #E2E8F0; width:33%;'>Severidad / Severity</td><td style='padding:6px; border-right:1px solid #E2E8F0; width:33%;'>Reincidencia / Reincidence</td><td style='padding:6px; width:33%;'>Impacto al Cliente / Customer Impact</td></tr>" +
          "<tr><td style='padding:8px; border-right:1px solid #E2E8F0;'>" + datos.clSeveridad + "<br><i style='color:#718096;'>" + sevEn + "</i></td><td style='padding:8px; border-right:1px solid #E2E8F0;'>" + datos.clReincidencia + "<br><i style='color:#718096;'>" + reinEn + "</i></td><td style='padding:8px;'>" + datos.clImpacto + "<br><i style='color:#718096;'>" + impEn + "</i></td></tr>" +
        "</table>" +

        "<div style='margin-top:40px; padding-top:20px; page-break-inside: avoid; border-top: 2px dashed #E2E8F0;'>" +
          "<table style='width:100%; border-collapse:collapse;'>" +
            "<tr>" +
              "<td style='width:50%; text-align:center; vertical-align:bottom; padding:0 30px;'>" + imgInspectorHtml + "<div style='width:100%; border-top:1px solid #393D42; margin-bottom:4px;'></div><div style='font-size:11px; font-weight:700; text-transform:uppercase;'>" + inspectorNombre + "</div><div style='font-size:9px; color:#718096;'>Auditor de Calidad / Quality Auditor</div></td>" +
              "<td style='width:50%; text-align:center; vertical-align:bottom; padding:0 30px;'>" + imgJefeHtml + "<div style='width:100%; border-top:1px solid #393D42; margin-bottom:4px;'></div><div style='font-size:11px; font-weight:700; color:#1A202C; text-transform:uppercase;'>Paulina Correa</div><div style='font-size:9px; color:#718096;'>Autorización / Authorized Signature</div></td>" +
            "</tr>" +
          "</table>" +
        "</div>" +
      "</div></body></html>";

    var finalBlob = Utilities.newBlob(htmlMaster, "text/html", "TempNCR.html").getAs(MimeType.PDF);
    var strFecha = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyyMMdd");
    var nombreArchivo = "NCR_" + datos.serie + "_" + strFecha + ".pdf";
    finalBlob.setName(nombreArchivo);
    
    var idCarpetaReclamos = " ";
    var carpetaDestino = DriveApp.getFolderById(idCarpetaReclamos);
    carpetaDestino.createFile(finalBlob);
    
  } catch(e) {
    Logger.log("Error en PDF de Reclamación: " + e.toString());
  }
}
