# Estacionamiento

## Backend

Sistema para gestión de bases de datos de estacionamiento.

## Creación del proyecto desde cero
```
md estacionamiento-backend
cd estacionamiento-backend
md src
cd src
md controllers, middlewares, helpers, services, utilities, common
```

## Archivos basicos
- Copiar archivo package.json a la raíz de estacionamiento-backend
- Copiar archivo README.md a la raíz de estacionamiento-backend
- Copiar archivo .gitignore a la raíz de estacionamiento-backend

## Git
En caso de uso de git, las instrucciones iniciales serian:

### Configuraciones básicas (En caso de que no se haya configurado antes)
```
git config --global user.name "Tu Nombre"
git config --global user.email "tu_correo@dominio.com"
```

### Configuraciones básicas dentro del proyecto raíz (estacionamiento-backend)
```
git init
git status
git add .
git commit -m "Inicio de repositorio"
```

## Project setup (Instalación de dependencias)
```
npm install
```

### Compiles and hot-reloads for development (Ejecutar el proyecto en modo desarrollo)
```
npm run dev
```

### Production (Ejecutar el proyecto en modo producción)
```
npm run start
```
