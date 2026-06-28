import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { UserProvider } from './context/UserContext';
import { Dashboard } from './pages/Dashboard';
import { StationPage } from './pages/StationPage';
import { ProvinciaPage } from './pages/ProvinciaPage';
import { CotizadorPage } from './pages/CotizadorPage';
import { VerificarPage } from './pages/VerificarPage';
import { NoticiasPage } from './pages/NoticiasPage';
import { ComparativaPage } from './pages/ComparativaPage';
import { DolarPage } from './pages/DolarPage';
import { RoadTripPage } from './pages/RoadTripPage';
import { VuelosPage } from './pages/VuelosPage';
import { SurtidoresPage } from './pages/SurtidoresPage';
import { PromosPage } from './pages/PromosPage';

export function App() {
  return (
    <UserProvider>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/estacion/:slug" element={<StationPage />} />
        <Route path="/precios/:provincia" element={<ProvinciaPage />} />
        <Route path="/cotizador" element={<CotizadorPage />} />
        <Route path="/seguros" element={<Navigate to="/cotizador" replace />} />
        <Route path="/verificar" element={<VerificarPage />} />
        <Route path="/noticias" element={<NoticiasPage />} />
        <Route path="/comparativa" element={<ComparativaPage />} />
        <Route path="/dolar" element={<DolarPage />} />
        <Route path="/viaje" element={<RoadTripPage />} />
        <Route path="/vuelos" element={<VuelosPage />} />
        <Route path="/surtidores" element={<SurtidoresPage />} />
        <Route path="/promos"    element={<PromosPage />} />
        {/* Fallback */}
        <Route path="*" element={<Dashboard />} />
      </Routes>
    </BrowserRouter>
    </UserProvider>
  );
}
