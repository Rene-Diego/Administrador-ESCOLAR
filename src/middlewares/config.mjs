// Librerias
import dotenv from "dotenv";

// Se cargan las variables de entorno
dotenv.config();

// Aqui se indica donde corre el proyecto
export default {
  NODE_ENV: process.env.NODE_ENV || "development",
  HOST: process.env.HOST || "localhost",
  PORT: process.env.PORT || 9090,
};
