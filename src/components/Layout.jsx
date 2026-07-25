import React, { useState } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { FileText, HelpCircle, PanelLeftClose, PanelLeftOpen, Sparkles, Library } from 'lucide-react';

export default function Layout() {
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();

  const itemCls = (active) =>
    `flex items-center justify-center gap-2 w-full py-2.5 mt-2 rounded-lg text-sm font-medium transition-colors ${
      active ? 'bg-[#e8f0fe] text-[#1a73e8]' : 'text-[#3c4043] hover:bg-[#f1f3f4]'
    } ${collapsed ? 'px-0' : 'px-4'}`;

  return (
    <div className="flex h-screen bg-[#f8f9fa]">
      {/* Sidebar */}
      <aside
        className={`${collapsed ? 'w-16' : 'w-64'} flex-shrink-0 bg-[#f8f9fa] border-r border-[#dadce0] flex flex-col transition-all duration-200`}
      >
        <div className={`py-5 border-b border-[#dadce0] flex items-center ${collapsed ? 'justify-center px-2' : 'justify-between px-5'}`}>
          {!collapsed && (
            <Link to="/trabalhista/gerar-entrevista" className="flex items-center gap-2 min-w-0">
              <FileText className="w-5 h-5 text-[#1a73e8] flex-shrink-0" />
              <span className="font-semibold text-[#202124] text-[15px] truncate">Petições FAV</span>
            </Link>
          )}
          <button
            onClick={() => setCollapsed(!collapsed)}
            title={collapsed ? 'Expandir menu' : 'Recolher menu'}
            className="p-1.5 text-[#5f6368] hover:bg-[#e8eaed] hover:text-[#202124] rounded-lg transition-colors flex-shrink-0"
          >
            {collapsed ? <PanelLeftOpen className="w-5 h-5" /> : <PanelLeftClose className="w-5 h-5" />}
          </button>
        </div>

        <div className={`py-4 flex-1 ${collapsed ? 'px-2' : 'px-4'}`}>
          <Link
            to="/trabalhista/gerar-entrevista"
            title="Gerar por Entrevista"
            className={itemCls(location.pathname === '/trabalhista/gerar-entrevista')}
          >
            <Sparkles className="w-4 h-4 flex-shrink-0" />
            {!collapsed && 'Gerar por Entrevista'}
          </Link>
          <Link
            to="/modelos"
            title="Modelos / Configurações"
            className={itemCls(location.pathname === '/modelos')}
          >
            <Library className="w-4 h-4 flex-shrink-0" />
            {!collapsed && 'Modelos / Configurações'}
          </Link>
        </div>

        <div className={`py-4 border-t border-[#dadce0] ${collapsed ? 'px-2 flex justify-center' : 'px-4'}`}>
          <button title="Ajuda" className="flex items-center gap-2 text-sm text-[#5f6368] hover:text-[#202124]">
            <HelpCircle className="w-4 h-4" />
            {!collapsed && 'Ajuda'}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
