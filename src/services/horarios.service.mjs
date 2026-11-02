import connect from '../middlewares/db.mjs';
import { talleresService } from './talleres.service.mjs';
import { recesosService } from './recesos.service.mjs';

export const DIAS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes'];

const INICIO_JORNADA_MIN = 8 * 60; // 08:00 AM
const DURACION_MODULO_MIN = 50;
const TOTAL_MODULOS_DIA = 8; 
const DURACION_RECESO_DEFECTO = 30;
const RANGO_ADYACENCIA_TALLER_MIN = 180; 
export const MAX_HORAS_MATERIA_POR_DIA = 2;

export function normalizarTexto(txt) {
  return (txt || '').normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
}

export function normalizarGrado(g) {
  return String(g || '').replace(/[^0-9]/g, '');
}

export function minutosDesdeHHMM(hhmm) {
  if (!hhmm) return null;
  const [hh, mm] = String(hhmm).split(':').map(n => parseInt(n, 10));
  if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
  return hh * 60 + mm;
}

function formatoHora12(totalMin) {
  let h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const sufijo = h >= 12 ? 'PM' : 'AM';
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  return `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${sufijo}`;
}

function formatoRangoHora(ini, fin) {
  return `${formatoHora12(ini)} - ${formatoHora12(fin)}`;
}

export function obtenerEstructuraHorario(horaInicioRecesoHHMM, duracionRecesoMin = DURACION_RECESO_DEFECTO) {
  const inicioRecesoMin = minutosDesdeHHMM(horaInicioRecesoHHMM);
  const estructura = [];
  let cursor = INICIO_JORNADA_MIN;
  let modulosColocados = 0;
  let recesoColocado = false;

  while (modulosColocados < TOTAL_MODULOS_DIA) {
    if (!recesoColocado && inicioRecesoMin !== null && cursor >= inicioRecesoMin) {
      estructura.push({ hora: formatoRangoHora(cursor, cursor + duracionRecesoMin), ini: cursor, fin: cursor + duracionRecesoMin, esReceso: true });
      cursor += duracionRecesoMin;
      recesoColocado = true;
      continue;
    }
    estructura.push({ hora: formatoRangoHora(cursor, cursor + DURACION_MODULO_MIN), ini: cursor, fin: cursor + DURACION_MODULO_MIN, esReceso: false });
    cursor += DURACION_MODULO_MIN;
    modulosColocados++;
  }

  if (!recesoColocado) {
    estructura.push({ hora: formatoRangoHora(cursor, cursor + duracionRecesoMin), ini: cursor, fin: cursor + duracionRecesoMin, esReceso: true });
  }

  return estructura;
}

export function resolverHorarioEscolar(asignaciones, recesos, talleres, docentesInfo) {
  const setGrupos = new Set();
  asignaciones.forEach(a => {
    if (a.grupo && a.grupo.toUpperCase() !== 'TODOS') {
      setGrupos.add(String(a.grupo).trim());
    }
  });
  const listaGrupos = Array.from(setGrupos).sort();

  const configsPorGrupo = {};
  listaGrupos.forEach(g => {
    let rec = { hora_inicio: '10:30', duracion_minutos: DURACION_RECESO_DEFECTO };
    if (g.startsWith('1')) rec = recesos?.[1] || rec;
    else if (g.startsWith('2')) rec = recesos?.[2] || rec;
    else if (g.startsWith('3')) rec = recesos?.[3] || rec;
    configsPorGrupo[g] = obtenerEstructuraHorario(rec.hora_inicio, rec.duracion_minutos);
  });

  const infoDocentePorNombre = {};
  (docentesInfo || []).forEach(d => {
    infoDocentePorNombre[normalizarTexto(d.nombre)] = {
      diasPreferentes: (d.dias_preferentes || []).map(normalizarTexto),
      color: d.color || null
    };
  });

  const talleresActivos = (talleres || [])
    .filter(t => t.activo)
    .map(t => ({
      nombre: t.nombre,
      dia: normalizarTexto(t.dia),
      ini: minutosDesdeHHMM(t.hora_inicio),
      fin: minutosDesdeHHMM(t.hora_fin),
      docente: t.docente_nombre ? normalizarTexto(t.docente_nombre) : null,
      docenteOriginal: t.docente_nombre || null
    }))
    .filter(t => t.dia && t.ini !== null && t.fin !== null);

  const talleresPorDocente = {};
  talleresActivos.forEach(t => {
    if (!t.docente) return;
    if (!talleresPorDocente[t.docente]) talleresPorDocente[t.docente] = {};
    talleresPorDocente[t.docente][t.dia] = talleresPorDocente[t.docente][t.dia] || [];
    talleresPorDocente[t.docente][t.dia].push({ ini: t.ini, fin: t.fin });
  });

  let mejorMatriz = null;
  let menorFaltantes = Infinity;
  let menorColisiones = Infinity;
  let mejorSeguimiento = null;

  for (let intento = 0; intento < 35; intento++) {
    const ocupacionDocentes = {};
    const diasUsadosDocente = {};
    const limiteDiasDocente = {};

    asignaciones.forEach(a => {
      const doc = normalizarTexto(a.docente);
      if (!ocupacionDocentes[doc]) {
        ocupacionDocentes[doc] = { lunes: [], martes: [], miercoles: [], jueves: [], viernes: [] };
        diasUsadosDocente[doc] = new Set();
        limiteDiasDocente[doc] = parseInt(a.dias, 10) || 5;
      }
    });
    talleresActivos.forEach(t => {
      if (!t.docente) return;
      if (!ocupacionDocentes[t.docente]) {
        ocupacionDocentes[t.docente] = { lunes: [], martes: [], miercoles: [], jueves: [], viernes: [] };
        diasUsadosDocente[t.docente] = new Set();
        limiteDiasDocente[t.docente] = 5;
      }
    });

    const docenteOcupadoEnRango = (doc, dia, ini, fin) => {
      const intervalos = ocupacionDocentes[doc]?.[dia] || [];
      return intervalos.some(slot => ini < slot.fin && fin > slot.ini);
    };

    const registrarOcupacionDocente = (doc, dia, ini, fin, grupo) => {
      if (!ocupacionDocentes[doc]) {
        ocupacionDocentes[doc] = { lunes: [], martes: [], miercoles: [], jueves: [], viernes: [] };
        diasUsadosDocente[doc] = new Set();
      }
      ocupacionDocentes[doc][dia].push({ ini, fin, grupo });
      diasUsadosDocente[doc].add(dia);
    };

    // FUNCIÓN ACTUALIZADA: Prioriza días preferentes y respeta días totales
    const ordenarDiasConPrioridad = (doc, diasBase) => {
      const info = infoDocentePorNombre[doc];
      const diasPref = info ? info.diasPreferentes : [];
      const diasUsados = diasUsadosDocente[doc] || new Set();

      return [...diasBase].sort((d1, d2) => {
        const esPref1 = diasPref.includes(d1);
        const esPref2 = diasPref.includes(d2);

        const abierto1 = diasUsados.has(d1);
        const abierto2 = diasUsados.has(d2);

        // 1. Prioridad máxima: Días preferentes del docente
        if (esPref1 !== esPref2) {
          return esPref1 ? -1 : 1;
        }

        // 2. Segunda prioridad: Días ya abiertos para compactar asignaciones
        if (abierto1 !== abierto2) {
          return abierto1 ? -1 : 1;
        }

        return 0;
      });
    };

    const matriz = {};
    listaGrupos.forEach(g => {
      matriz[g] = configsPorGrupo[g].map(slot => {
        const f = { hora: slot.hora, ini: slot.ini, fin: slot.fin, esReceso: slot.esReceso };
        DIAS.forEach(d => { f[d] = slot.esReceso ? 'Receso' : 'Libre'; });
        return f;
      });
    });

    talleresActivos.forEach(t => {
      listaGrupos.forEach(g => {
        const estructura = configsPorGrupo[g];
        estructura.forEach((slot, idx) => {
          if (slot.esReceso) return;
          const solapa = t.ini < slot.fin && t.fin > slot.ini;
          if (!solapa) return;
          if (matriz[g][idx][t.dia] !== 'Libre') return;

          matriz[g][idx][t.dia] = 'TALLERES';

          if (t.docente) {
            registrarOcupacionDocente(t.docente, t.dia, slot.ini, slot.fin, g);
          }
        });
      });
    });

    const tutoriasGrado = asignaciones.filter(a => String(a.grupo).toUpperCase() === 'TODOS');
    tutoriasGrado.forEach(tg => {
      const grdNorm = normalizarGrado(tg.grado);
      const gruposDelGrado = listaGrupos.filter(g => normalizarGrado(g) === grdNorm);
      if (gruposDelGrado.length === 0) return;

      const doc = normalizarTexto(tg.docente);
      const mNom = normalizarTexto(tg.materia);

      let diasPrioridad = ['viernes', 'lunes', 'martes', 'miercoles', 'jueves'];
      if (mNom.includes('ingles')) diasPrioridad = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes'];
      else if (mNom.includes('comunicacion')) diasPrioridad = ['martes', 'miercoles', 'jueves', 'viernes', 'lunes'];
      else if (mNom.includes('tecnologia') || mNom.includes('digital')) diasPrioridad = ['miercoles', 'jueves', 'viernes', 'lunes', 'martes'];
      else if (mNom.includes('natural') || mNom.includes('ciencia')) diasPrioridad = ['jueves', 'viernes', 'miercoles', 'lunes', 'martes'];
      else if (mNom.includes('matematica')) diasPrioridad = ['viernes', 'jueves', 'miercoles', 'martes', 'lunes'];

      for (const d of diasPrioridad) {
        const uIdx = matriz[gruposDelGrado[0]].length - 1;
        const ini = matriz[gruposDelGrado[0]][uIdx].ini;
        const fin = matriz[gruposDelGrado[0]][uIdx].fin;

        const todosLibres = gruposDelGrado.every(g => matriz[g][uIdx][d] === 'Libre');
        const docDisponible = !docenteOcupadoEnRango(doc, d, ini, fin);
        const respetaDias = diasUsadosDocente[doc]?.has(d) || (diasUsadosDocente[doc]?.size < limiteDiasDocente[doc]);

        if (todosLibres && docDisponible && respetaDias) {
          gruposDelGrado.forEach(g => {
            matriz[g][uIdx][d] = `${tg.materia} (${tg.docente})`;
          });
          registrarOcupacionDocente(doc, d, ini, fin, `GRADO ${grdNorm}`);
          break;
        }
      }
    });

    const asignacionesUltimo = asignaciones.filter(a =>
      String(a.grupo).toUpperCase() !== 'TODOS' && a.horario_preferente === 'ultimo_modulo'
    );

    asignacionesUltimo.forEach(asig => {
      const g = String(asig.grupo).trim();
      if (!matriz[g]) return;
      const doc = normalizarTexto(asig.docente);
      const horas = parseInt(asig.horas_semanales, 10) || 1;
      const uIdx = matriz[g].length - 1;
      const ini = matriz[g][uIdx].ini;
      const fin = matriz[g][uIdx].fin;
      let colocadas = 0;

      const diasOrdenados = ordenarDiasConPrioridad(doc, DIAS);

      for (const d of diasOrdenados) {
        if (colocadas >= horas) break;
        const slotLibre = matriz[g][uIdx][d] === 'Libre';
        const docLibre = !docenteOcupadoEnRango(doc, d, ini, fin);
        const respetaDias = diasUsadosDocente[doc]?.has(d) || (diasUsadosDocente[doc]?.size < limiteDiasDocente[doc]);

        if (slotLibre && docLibre && respetaDias) {
          matriz[g][uIdx][d] = `${asig.materia} (${asig.docente})`;
          registrarOcupacionDocente(doc, d, ini, fin, g);
          colocadas++;
        }
      }
    });

    const paquetesPorGrupo = {};
    const seguimientoHoras = {};
    const horasMateriaDia = {};

    listaGrupos.forEach(g => {
      paquetesPorGrupo[g] = [];
      seguimientoHoras[g] = {};
      horasMateriaDia[g] = {};
    });

    asignaciones
      .filter(a => String(a.grupo).toUpperCase() !== 'TODOS' && a.horario_preferente !== 'ultimo_modulo')
      .forEach(asig => {
        const g = String(asig.grupo).trim();
        if (!paquetesPorGrupo[g]) return;

        let hrs = parseInt(asig.horas_semanales, 10) || 0;
        const requiereDoble = Number(asig.requiere_bloque_doble) === 1 || asig.requiere_bloque_doble === true;

        seguimientoHoras[g][asig.materia] = {
          requeridas: hrs,
          colocadas: 0,
          docente: asig.docente
        };
        horasMateriaDia[g][asig.materia] = { lunes: 0, martes: 0, miercoles: 0, jueves: 0, viernes: 0 };

        while (hrs >= 2) {
          paquetesPorGrupo[g].push({
            ...asig,
            duracion: 2,
            esIndivisible: requiereDoble
          });
          hrs -= 2;
        }
        if (hrs === 1) {
          paquetesPorGrupo[g].push({
            ...asig,
            duracion: 1,
            esIndivisible: false
          });
          hrs -= 1;
        }
      });

    const cabeEnCupoDiario = (g, materia, dia, cantidad) => {
      const usado = horasMateriaDia[g]?.[materia]?.[dia] || 0;
      return (usado + cantidad) <= MAX_HORAS_MATERIA_POR_DIA;
    };

    const registrarHorasMateriaDia = (g, materia, dia, cantidad) => {
      if (!horasMateriaDia[g][materia]) horasMateriaDia[g][materia] = { lunes: 0, martes: 0, miercoles: 0, jueves: 0, viernes: 0 };
      horasMateriaDia[g][materia][dia] = (horasMateriaDia[g][materia][dia] || 0) + cantidad;
    };

    const priorizarModulosPorTaller = (doc, dia, modulos, estructura) => {
      const talleresDia = talleresPorDocente[doc]?.[dia];
      if (!talleresDia || talleresDia.length === 0) return modulos;

      const cercaDeTaller = (idx) => {
        const slot = estructura[idx];
        return talleresDia.some(t =>
          (slot.ini >= t.ini - RANGO_ADYACENCIA_TALLER_MIN && slot.ini < t.ini) ||
          (slot.ini >= t.fin && slot.ini <= t.fin + RANGO_ADYACENCIA_TALLER_MIN)
        );
      };

      const cercanos = modulos.filter(cercaDeTaller);
      const lejanos = modulos.filter(idx => !cercaDeTaller(idx));
      return [...cercanos, ...lejanos];
    };

    const gruposOrdenados = [...listaGrupos].sort(() => (intento > 0 ? Math.random() - 0.5 : 0));

    gruposOrdenados.forEach(g => {
      const estructura = configsPorGrupo[g];
      const idxReceso = estructura.findIndex(slot => slot.esReceso);

      const paquetes = [...paquetesPorGrupo[g]].sort((a, b) => {
        const prefA = a.horario_preferente === 'primeras_horas' ? 1 : 0;
        const prefB = b.horario_preferente === 'primeras_horas' ? 1 : 0;
        if (prefA !== prefB) return prefB - prefA;

        const diasA = limiteDiasDocente[normalizarTexto(a.docente)];
        const diasB = limiteDiasDocente[normalizarTexto(b.docente)];
        if (diasA !== diasB) return diasA - diasB;
        if (b.duracion !== a.duracion) return b.duracion - a.duracion;
        return 0;
      });

      for (let item of paquetes) {
        const doc = normalizarTexto(item.docente);
        const maxDias = limiteDiasDocente[doc];
        let asignado = false;

        const ordenDias = ordenarDiasConPrioridad(doc, DIAS);

        for (const d of ordenDias) {
          if (asignado) break;
          const diaYaAbierto = diasUsadosDocente[doc]?.has(d);
          if (!diaYaAbierto && diasUsadosDocente[doc]?.size >= maxDias) continue;
          if (!cabeEnCupoDiario(g, item.materia, d, item.duracion)) continue;

          let modulos = [];

          if (item.horario_preferente === 'primeras_horas') {
            modulos = estructura
              .map((_, idx) => idx)
              .filter(idx => !estructura[idx].esReceso && (idxReceso === -1 || idx < idxReceso));
          } else if (item.horario_preferente === 'ultimas_horas') {
            modulos = estructura
              .map((_, idx) => idx)
              .filter(idx => !estructura[idx].esReceso)
              .sort((a, b) => b - a);
          } else {
            modulos = estructura
              .map((_, idx) => idx)
              .filter(idx => !estructura[idx].esReceso)
              .sort(() => Math.random() - 0.5);
          }

          modulos = priorizarModulosPorTaller(doc, d, modulos, estructura);

          for (const idx of modulos) {
            if (item.duracion === 2) {
              if (idx + 1 >= estructura.length) continue;
              if (estructura[idx].esReceso || estructura[idx + 1].esReceso) continue;

              if (item.horario_preferente === 'primeras_horas' && idxReceso !== -1 && idx + 1 >= idxReceso) {
                continue;
              }

              const libre1 = matriz[g][idx][d] === 'Libre';
              const libre2 = matriz[g][idx + 1][d] === 'Libre';
              const ini1 = estructura[idx].ini;
              const fin2 = estructura[idx + 1].fin;

              if (libre1 && libre2 && !docenteOcupadoEnRango(doc, d, ini1, fin2)) {
                matriz[g][idx][d] = `${item.materia} (${item.docente})`;
                matriz[g][idx + 1][d] = `${item.materia} (${item.docente})`;
                registrarOcupacionDocente(doc, d, ini1, fin2, g);
                registrarHorasMateriaDia(g, item.materia, d, 2);
                seguimientoHoras[g][item.materia].colocadas += 2;
                asignado = true;
                break;
              }
            } else {
              const libre = matriz[g][idx][d] === 'Libre';
              const ini = estructura[idx].ini;
              const fin = estructura[idx].fin;

              if (libre && !docenteOcupadoEnRango(doc, d, ini, fin)) {
                matriz[g][idx][d] = `${item.materia} (${item.docente})`;
                registrarOcupacionDocente(doc, d, ini, fin, g);
                registrarHorasMateriaDia(g, item.materia, d, 1);
                seguimientoHoras[g][item.materia].colocadas += 1;
                asignado = true;
                break;
              }
            }
          }
        }

        if (!asignado && item.duracion === 2) {
          if (item.esIndivisible) {
            continue; 
          }

          let horasRescatadas = 0;

          for (const d of ordenDias) {
            if (horasRescatadas >= 2) break;
            const diaYaAbierto = diasUsadosDocente[doc]?.has(d);
            if (!diaYaAbierto && diasUsadosDocente[doc]?.size >= maxDias) continue;
            if (!cabeEnCupoDiario(g, item.materia, d, 1)) continue;

            for (let idx = 0; idx < estructura.length; idx++) {
              if (horasRescatadas >= 2) break;
              if (estructura[idx].esReceso) continue;

              if (item.horario_preferente === 'primeras_horas' && idxReceso !== -1 && idx >= idxReceso) {
                continue;
              }

              if (!cabeEnCupoDiario(g, item.materia, d, 1)) break;

              const libre = matriz[g][idx][d] === 'Libre';
              const ini = estructura[idx].ini;
              const fin = estructura[idx].fin;

              if (libre && !docenteOcupadoEnRango(doc, d, ini, fin)) {
                matriz[g][idx][d] = `${item.materia} (${item.docente})`;
                registrarOcupacionDocente(doc, d, ini, fin, g);
                registrarHorasMateriaDia(g, item.materia, d, 1);
                seguimientoHoras[g][item.materia].colocadas += 1;
                horasRescatadas++;
              }
            }
          }
        }
      }
    });

    let faltantesIntento = 0;
    Object.keys(seguimientoHoras).forEach(g => {
      Object.keys(seguimientoHoras[g]).forEach(m => {
        const reg = seguimientoHoras[g][m];
        if (reg.colocadas < reg.requeridas) {
          faltantesIntento += (reg.requeridas - reg.colocadas);
        }
      });
    });

    const aud = auditarHorarios(matriz, configsPorGrupo, talleresActivos.map(t => t.nombre));

    if (aud.colisiones.length < menorColisiones || (aud.colisiones.length === menorColisiones && faltantesIntento < menorFaltantes)) {
      menorColisiones = aud.colisiones.length;
      menorFaltantes = faltantesIntento;
      mejorMatriz = JSON.parse(JSON.stringify(matriz));
      mejorSeguimiento = JSON.parse(JSON.stringify(seguimientoHoras));
      if (menorColisiones === 0 && menorFaltantes === 0) break;
    }
  }

  const incumplimientosHoras = [];
  if (mejorSeguimiento) {
    Object.keys(mejorSeguimiento).forEach(g => {
      Object.keys(mejorSeguimiento[g]).forEach(m => {
        const reg = mejorSeguimiento[g][m];
        if (reg.colocadas < reg.requeridas) {
          incumplimientosHoras.push({
            grupo: g,
            materia: m,
            docente: reg.docente,
            horasRequeridas: reg.requeridas,
            horasColocadas: reg.colocadas,
            horasFaltantes: reg.requeridas - reg.colocadas
          });
        }
      });
    });
  }

  return { matriz: mejorMatriz, configsPorGrupo, incumplimientosHoras };
}

export function auditarHorarios(gruposObj, configsPorGrupo, nombresTalleresGenerales = []) {
  const colisiones = [];
  const listaGrupos = Object.keys(gruposObj);
  const nombresTalleresNorm = nombresTalleresGenerales.map(normalizarTexto);

  DIAS.forEach(dia => {
    const mapaOcupacion = [];
    listaGrupos.forEach(g => {
      // 🛡️ Si el grupo representa a todo el grado, lo omitimos de la auditoría de empalmes individuales
      if (normalizarTexto(g).includes('grado')) return;

      gruposObj[g].forEach((fila, idx) => {
        const celda = fila[dia] || '';
        const match = celda.match(/\((.*?)\)/);
        if (match && match[1]) {
          const d = normalizarTexto(match[1]);
          if (!['receso', 'libre', 'tutoria', 'tutorias', 'taller', 'talleres'].includes(d)) {
            const metaSlot = configsPorGrupo[g] && configsPorGrupo[g][idx];
            if (metaSlot) {
              mapaOcupacion.push({
                docente: d,
                grupo: g,
                hora: metaSlot.hora,
                ini: metaSlot.ini,
                fin: metaSlot.fin,
                materia: celda
              });
            }
          }
        }
      });
    });

    for (let i = 0; i < mapaOcupacion.length; i++) {
      for (let j = i + 1; j < mapaOcupacion.length; j++) {
        const o1 = mapaOcupacion[i];
        const o2 = mapaOcupacion[j];
        
        if (o1.docente === o2.docente && o1.grupo !== o2.grupo) {
          const grado1 = normalizarGrado(o1.grupo);
          const grado2 = normalizarGrado(o2.grupo);
          const mismoGrado = grado1 === grado2;

          const m1Norm = normalizarTexto(o1.materia);
          const m2Norm = normalizarTexto(o2.materia);
          const esTutoria = m1Norm.includes('tutoria') && m2Norm.includes('tutoria');

          if (mismoGrado && esTutoria && o1.ini === o2.ini) continue;

          const nombreMateria1 = normalizarTexto((o1.materia || '').replace(/\(.*?\)/, ''));
          const nombreMateria2 = normalizarTexto((o2.materia || '').replace(/\(.*?\)/, ''));
          const esTallerGeneral = nombresTalleresNorm.includes(nombreMateria1) && nombresTalleresNorm.includes(nombreMateria2);
          if (esTallerGeneral && o1.ini === o2.ini) continue;

          // 🛡️ EXCEPCIÓN PARA MATERIAS GENERALES / TODO EL GRADO (ej. matesssss)
          if (mismoGrado && nombreMateria1 === nombreMateria2 && o1.ini === o2.ini) continue;

          if (o1.ini < o2.fin && o2.ini < o1.fin) {
            colisiones.push(`Empalme: Docente "${o1.docente}" en ${dia} (${o1.hora}) entre ${o1.grupo} y ${o2.grupo}`);
          }
        }
      }
    }
  });

  return { valido: colisiones.length === 0, colisiones };
}

function convertirHora12a24(valor) {
  if (!valor) return null;
  const texto = String(valor).trim();

  if (/^\d{1,2}:\d{2}$/.test(texto)) {
    return texto;
  }

  const inicio = texto.split('-')[0].trim();
  const match = inicio.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!match) return null;
  let [, hh, mm, sufijo] = match;
  hh = parseInt(hh, 10);
  if (sufijo.toUpperCase() === 'PM' && hh !== 12) hh += 12;
  if (sufijo.toUpperCase() === 'AM' && hh === 12) hh = 0;
  return `${String(hh).padStart(2, '0')}:${mm}`;
}

export const horariosService = {
  async generar({ recesos, talleres }) {
    const db = await connect();

    // 1. Validar estrictamente en la base de datos si existe un semestre activo (estado = 1)
    const [semestresActivos] = await db.query(
      'SELECT * FROM semestres WHERE estado = 1 ORDER BY id DESC LIMIT 1'
    );

    if (!semestresActivos || semestresActivos.length === 0) {
      throw new Error('⚠️ No hay ningún semestre activado en el sistema. Debes activar un semestre antes de generar horarios.');
    }

    const semestreActivo = semestresActivos[0];
    const semestreId = semestreActivo.id;

    // 2. Consultar SOLO las asignaciones del semestre activo (por semestre_id)
    const queryAsignaciones = `
      SELECT 
        a.id AS asignacion_id, 
        COALESCE(d.nombre, 'Sin Docente') AS docente, 
        m.nombre AS materia, 
        a.grado, 
        a.grupo, 
        COALESCE(d.dias, 5) AS dias, 
        COALESCE(m.horas_semanales, 3) AS horas_semanales, 
        COALESCE(m.requiere_bloque_doble, 0) AS requiere_bloque_doble, 
        COALESCE(m.horario_preferente, 'indiferente') AS horario_preferente 
      FROM asignaciones a 
      LEFT JOIN docentes d ON a.docente_id = d.id 
      LEFT JOIN materias m ON a.materia_id = m.id
      WHERE a.semestre_id = ?
    `;

    const [asignaciones] = await db.query(queryAsignaciones, [semestreId]);

    if (!asignaciones || asignaciones.length === 0) {
      throw new Error(`No se encontraron asignaciones para el semestre activo "${semestreActivo.nombre}". Captura asignaciones en este semestre antes de generar horarios.`);
    }

    const [docentesRows] = await db.query(
      'SELECT id, nombre, dias_preferentes, color FROM docentes WHERE semestre_id = ?',
      [semestreId]
    );
    const docentesInfo = docentesRows.map(d => ({
      ...d,
      dias_preferentes: d.dias_preferentes ? String(d.dias_preferentes).split(',').map(s => s.trim()) : []
    }));

    const recesosDb = await recesosService.getAll();
    const recesosFinal = {
      1: recesos?.grado1 ? { hora_inicio: convertirHora12a24(recesos.grado1), duracion_minutos: DURACION_RECESO_DEFECTO } : recesosDb[1],
      2: recesos?.grado2 ? { hora_inicio: convertirHora12a24(recesos.grado2), duracion_minutos: DURACION_RECESO_DEFECTO } : recesosDb[2],
      3: recesos?.grado3 ? { hora_inicio: convertirHora12a24(recesos.grado3), duracion_minutos: DURACION_RECESO_DEFECTO } : recesosDb[3]
    };

    const talleresDb = await talleresService.getAll(semestreId);
    const talleresFinal = (talleres && talleres.usarSoloBody) ? (talleres.lista || []) : talleresDb;

    const { matriz: horariosFinales, configsPorGrupo, incumplimientosHoras } = resolverHorarioEscolar(
      asignaciones, recesosFinal, talleresFinal, docentesInfo
    );
    const auditoria = auditarHorarios(horariosFinales, configsPorGrupo, talleresFinal.map(t => t.nombre));

    const coloresDocentes = {};
    docentesInfo.forEach(d => { coloresDocentes[d.nombre] = d.color; });

    return {
      exito: true,
      horarios: horariosFinales,
      gruposGenerados: Object.keys(horariosFinales),
      totalGrupos: Object.keys(horariosFinales).length,
      incumplimientosHoras,
      inconsistencias: auditoria.colisiones,
      esMatematicamentePosible: auditoria.valido && incumplimientosHoras.length === 0,
      advertenciasRestricciones: [],
      coloresDocentes,
      talleresAplicados: talleresFinal.map(t => ({ nombre: t.nombre, dia: t.dia, hora_inicio: t.hora_inicio, hora_fin: t.hora_fin, docente: t.docente_nombre || null }))
    };
  }
};