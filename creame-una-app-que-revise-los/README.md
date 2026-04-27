# App de gasolineras para toda Espana

Esta app compara dos cosas a la vez:

- la gasolinera con el precio de diesel mas bajo
- la gasolinera que mas compensa cuando sumas el combustible gastado para llegar hasta ella

La ubicacion de salida se elige directamente en un mapa de Espana.

## Como arrancarla en local

```powershell
.\start-app.cmd
```

Si prefieres PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\start-app.ps1
```

Despues abre:

```text
http://127.0.0.1:4173
```

## Como actualizar el dataset oficial

```powershell
.\update-dataset.cmd
```

o, si prefieres PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\update-dataset.ps1
```

El fichero generado es:

```text
public/data/stations.es.json
```

## GitHub Pages

El proyecto queda listo para subirlo a GitHub y desplegarlo con GitHub Pages usando Actions.

1. Sube el repo a GitHub.
2. En `Settings > Pages`, deja como fuente `GitHub Actions`.
3. Haz push a `main` o `master`.
4. El workflow construira el dataset y desplegara la carpeta `public`.

Tambien queda programado un redeploy cada 30 minutos para refrescar el dataset oficial.

## Supuestos por defecto

- origen inicial: Espinardo
- radio: 50 km por carretera
- consumo: 7,8 L/100 km
- litros a repostar: 40 L
- calculo del viaje: ida y vuelta
- distancias: ruta real por carretera con OSRM y, si falla, aproximacion fija interna
