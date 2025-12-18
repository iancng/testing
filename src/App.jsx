import React, { useState, useEffect, useMemo, useRef } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Brush } from 'recharts';
import { Settings, Info, RefreshCw, TrendingUp, TrendingDown, Moon, Sun, Globe, Scale, Clock, Wifi, WifiOff, Activity, AlertTriangle, Maximize2, Minimize2, MoveHorizontal } from 'lucide-react';

// --- Constants & Config ---

const COINGECKO_API_URL = "https://api.coingecko.com/api/v3";

const SOURCES = [
  { id: 'pax-gold', name: 'PAX Gold (Paxos)', symbol: 'PAXG' },
  { id: 'tether-gold', name: 'Tether Gold', symbol: 'XAUt' }
];

const CURRENCIES = [
  { code: 'USD', symbol: '$', name: 'US Dollar' },
  { code: 'HKD', symbol: 'HK$', name: 'Hong Kong Dollar' },
  { code: 'EUR', symbol: '€', name: 'Euro' },
  { code: 'JPY', symbol: '¥', name: 'Japanese Yen' },
  { code: 'GBP', symbol: '£', name: 'British Pound' },
  { code: 'CNY', symbol: '¥', name: 'Chinese Yuan' },
  { code: 'SGD', symbol: 'S$', name: 'Singapore Dollar' },
  { code: 'AUD', symbol: 'A$', name: 'Australian Dollar' },
  { code: 'CAD', symbol: 'C$', name: 'Canadian Dollar' },
];

const UNITS = [
  { code: 'oz', name: 'Troy Ounce', multiplier: 1 },
  { code: 'g', name: 'Gram', multiplier: 1 / 31.1034768 },
  { code: 'kg', name: 'Kilogram', multiplier: 1000 / 31.1034768 },
  { code: 'mace', name: 'HK Mace (Cheung)', multiplier: 0.120337 }, // ~3.7429g
  { code: 'tael', name: 'HK Tael (Leung)', multiplier: 1.20337 },   // ~37.429g
];

const TIME_RANGES = [
  { label: '1H', days: 1, slice: '1h' },
  { label: '8H', days: 1, slice: '8h' },
  { label: '24H', days: 1, slice: '24h' },
  { label: '7D', days: 7, slice: 'all' },
  { label: '1M', days: 30, slice: 'all' },
];

// --- Helper Components ---

const Card = ({ children, className = "" }) => (
  <div className={`bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 ${className}`}>
    {children}
  </div>
);

const Modal = ({ isOpen, onClose, title, children }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-800 w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden border border-slate-200 dark:border-slate-700">
        <div className="flex justify-between items-center p-4 border-b border-slate-100 dark:border-slate-700">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">{title}</h3>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition-colors">
            <Settings size={20} className="text-slate-500" />
          </button>
        </div>
        <div className="p-6 max-h-[80vh] overflow-y-auto">
          {children}
        </div>
        <div className="p-4 border-t border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 flex justify-end">
          <button 
            onClick={onClose}
            className="px-4 py-2 bg-slate-900 dark:bg-amber-500 text-white rounded-lg hover:opacity-90 transition-opacity font-medium"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

// --- Main Application ---

export default function GoldMonitor() {
  // State
  const [prices, setPrices] = useState(null);
  const [chartHistory, setChartHistory] = useState([]);
  
  // Settings
  const [currency, setCurrency] = useState('USD');
  const [unit, setUnit] = useState('oz');
  const [timeRange, setTimeRange] = useState('24H');
  const [darkMode, setDarkMode] = useState(true);
  const [sourceId, setSourceId] = useState(SOURCES[0].id);
  const [isPanMode, setIsPanMode] = useState(false);
  
  // Status
  const [isLive, setIsLive] = useState(true);
  const [loading, setLoading] = useState(true);
  const [chartLoading, setChartLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showAbout, setShowAbout] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [usingProxy, setUsingProxy] = useState(false);
  
  // Simulated Live Ticker State
  const [displayPrice, setDisplayPrice] = useState(0);

  // Derived
  const currentCurrency = CURRENCIES.find(c => c.code === currency) || CURRENCIES[0];
  const currentUnit = UNITS.find(u => u.code === unit) || UNITS[0];
  const currentSource = SOURCES.find(s => s.id === sourceId) || SOURCES[0];

  // --- Effects ---

  // 1. Initial Load & Theme
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  // --- API Fetcher with Proxy Fallback ---
  const fetchWithFallback = async (url) => {
    try {
      // Try direct connection first
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Direct fetch error: ${response.status}`);
      setUsingProxy(false);
      return await response.json();
    } catch (directErr) {
      console.warn("Direct fetch failed, attempting proxy...", directErr);
      try {
        // Fallback to 'allorigins' proxy if CORS fails
        const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
        const response = await fetch(proxyUrl);
        if (!response.ok) throw new Error(`Proxy fetch error: ${response.status}`);
        setUsingProxy(true);
        return await response.json();
      } catch (proxyErr) {
        throw new Error("Unable to connect to data provider.");
      }
    }
  };

  // 2. Data Fetching (Current Price)
  const fetchCurrentPrice = async () => {
    if (!isLive) return; 

    try {
      const currencyList = CURRENCIES.map(c => c.code.toLowerCase()).join(',');
      const url = `${COINGECKO_API_URL}/simple/price?ids=${sourceId}&vs_currencies=${currencyList}&include_24hr_change=true&include_24hr_vol=true&include_last_updated_at=true`;
      
      const data = await fetchWithFallback(url);
      
      if (data[sourceId]) {
        setPrices(data[sourceId]);
        setLastUpdated(new Date());
        setError(null);
      }
    } catch (err) {
      console.error("Price fetch failed:", err);
      if (!prices) setError("Connecting to market data..."); // Softer error message
    } finally {
      setLoading(false);
    }
  };

  // 3. Data Fetching (Chart)
  const fetchChartData = async () => {
    setChartLoading(true);
    const rangeConfig = TIME_RANGES.find(r => r.label === timeRange);
    const days = rangeConfig.days;

    try {
      const url = `${COINGECKO_API_URL}/coins/${sourceId}/market_chart?vs_currency=${currency.toLowerCase()}&days=${days}`;
      const data = await fetchWithFallback(url);
      
      let history = data.prices || [];

      // Slice logic for shorter timeframes
      const now = Date.now();
      if (rangeConfig.slice === '1h') {
        const oneHourAgo = now - 60 * 60 * 1000;
        history = history.filter(p => p[0] >= oneHourAgo);
      } else if (rangeConfig.slice === '8h') {
        const eightHoursAgo = now - 8 * 60 * 60 * 1000;
        history = history.filter(p => p[0] >= eightHoursAgo);
      }

      setChartHistory(history);
    } catch (err) {
      console.error("Chart fetch failed:", err);
    } finally {
      setChartLoading(false);
    }
  };

  // Initial Fetch & Interval
  useEffect(() => {
    fetchCurrentPrice();
    let interval;
    if (isLive) {
      interval = setInterval(fetchCurrentPrice, 60000); 
    }
    return () => clearInterval(interval);
  }, [isLive, sourceId]); 

  // Fetch chart on dependency changes
  useEffect(() => {
    fetchChartData();
  }, [currency, timeRange, sourceId]);

  // 4. Live Ticker Simulation
  useEffect(() => {
    if (!prices || !isLive) return;
    
    const basePrice = prices[currency.toLowerCase()] || 0;
    const finalPrice = basePrice * currentUnit.multiplier;
    
    // Reset to exact price when actual data updates
    setDisplayPrice(finalPrice); 

    const ticker = setInterval(() => {
      const volatility = finalPrice * 0.0002; 
      const noise = (Math.random() - 0.5) * volatility;
      
      setDisplayPrice(prev => {
        const drift = (finalPrice - prev) * 0.1; 
        return prev + noise + drift;
      });
    }, 1500);

    return () => clearInterval(ticker);
  }, [prices, currency, unit, isLive]);


  // --- Formatters ---

  const formatPrice = (val) => {
    if (val === undefined || val === null) return '---';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency,
      minimumFractionDigits: unit === 'g' || unit === 'mace' ? 2 : 2,
      maximumFractionDigits: 2,
    }).format(val);
  };

  const getPercentChange = () => {
    if (!prices) return 0;
    return prices[`${currency.toLowerCase()}_24h_change`] || 0;
  };

  const percentChange = getPercentChange();
  const isPositive = percentChange >= 0;

  // --- Render ---

  return (
    <div className={`min-h-screen transition-colors duration-300 ${darkMode ? 'bg-slate-900 text-slate-100' : 'bg-slate-50 text-slate-900'} font-sans selection:bg-amber-500 selection:text-white`}>
      
      {/* Header */}
      <nav className="border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center shadow-lg shadow-amber-500/20">
                <Scale className="text-white" size={18} />
              </div>
              <span className="font-bold text-xl tracking-tight hidden sm:block">
                Gold<span className="text-amber-500">Mace</span>
              </span>
            </div>

            <div className="flex items-center gap-2 sm:gap-4">
              <button 
                onClick={() => setDarkMode(!darkMode)}
                className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-slate-500 dark:text-slate-400"
              >
                {darkMode ? <Sun size={20} /> : <Moon size={20} />}
              </button>
              
              <button 
                onClick={() => setShowAbout(true)}
                className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-slate-500 dark:text-slate-400"
              >
                <Info size={20} />
              </button>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        
        {/* Error / Status Bar */}
        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-3 rounded-lg flex items-center gap-2 text-sm border border-red-200 dark:border-red-800/50">
            <AlertTriangle size={16} />
            {error}
          </div>
        )}
        
        {/* Proxy Indicator (Subtle) */}
        {usingProxy && !error && (
          <div className="bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 p-2 rounded-lg flex items-center justify-center gap-2 text-xs border border-blue-200 dark:border-blue-800/50">
            <Wifi size={12} />
            Using secure proxy connection
          </div>
        )}

        {/* Controls Bar */}
        <div className="flex flex-col md:flex-row gap-4">
          <Card className="flex-1 p-1 flex flex-wrap gap-1 bg-slate-100 dark:bg-slate-800/50 border-none">
            {CURRENCIES.slice(0, 5).map((c) => (
              <button
                key={c.code}
                onClick={() => setCurrency(c.code)}
                className={`flex-1 min-w-[60px] py-2 px-3 rounded-lg text-sm font-semibold transition-all ${
                  currency === c.code 
                    ? 'bg-white dark:bg-slate-700 text-amber-600 dark:text-amber-400 shadow-sm' 
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {c.code}
              </button>
            ))}
          </Card>

          <Card className="flex-1 p-1 flex flex-wrap gap-1 bg-slate-100 dark:bg-slate-800/50 border-none">
            {UNITS.map((u) => (
              <button
                key={u.code}
                onClick={() => setUnit(u.code)}
                className={`flex-1 min-w-[60px] py-2 px-3 rounded-lg text-sm font-semibold transition-all ${
                  unit === u.code 
                    ? 'bg-white dark:bg-slate-700 text-amber-600 dark:text-amber-400 shadow-sm' 
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {u.code.toUpperCase()}
              </button>
            ))}
          </Card>
        </div>

        {/* Source Selector */}
        <div className="flex items-center gap-3 bg-slate-100 dark:bg-slate-800/50 p-2 rounded-lg w-full md:w-auto self-start inline-flex">
           <span className="text-xs font-bold text-slate-400 uppercase tracking-wider ml-2">Data Source:</span>
           {SOURCES.map(source => (
             <button
              key={source.id}
              onClick={() => setSourceId(source.id)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                sourceId === source.id
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm ring-1 ring-slate-200 dark:ring-slate-600'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
             >
               {source.name}
             </button>
           ))}
        </div>

        {/* Main Ticker Display - Full Width */}
        <Card className="p-6 md:p-10 relative overflow-hidden group">
          {/* Background Glow */}
          <div className="absolute top-0 right-0 w-96 h-96 bg-amber-500/10 dark:bg-amber-500/5 rounded-full blur-3xl -mr-24 -mt-24 pointer-events-none"></div>
          
          <div className="relative z-10">
            <div className="flex justify-between items-start mb-4">
              <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 text-sm font-medium">
                <Globe size={14} />
                <span>{currentSource.name} Index</span>
              </div>
              
              <div className="hidden md:block text-right">
                <div className="flex items-center justify-end gap-1 text-slate-600 dark:text-slate-300 font-mono text-sm">
                  <Clock size={12} />
                  <span>Updated: {lastUpdated ? lastUpdated.toLocaleTimeString() : '--:--:--'}</span>
                </div>
              </div>
            </div>
            
            <div className="flex flex-col md:flex-row md:items-end gap-6">
              <div>
                <div className="flex items-center gap-4">
                  <h1 className="text-5xl md:text-7xl font-bold text-slate-900 dark:text-white tracking-tight tabular-nums">
                    {loading ? (
                      <span className="animate-pulse text-slate-300 dark:text-slate-700">Loading...</span>
                    ) : (
                      formatPrice(displayPrice)
                    )}
                  </h1>
                  
                  {/* Interactive Live Button */}
                  <button 
                    onClick={() => setIsLive(!isLive)}
                    className={`
                      flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-bold uppercase tracking-wide transition-all shadow-sm border
                      ${isLive 
                        ? 'bg-green-500/10 text-green-600 border-green-500/20 hover:bg-green-500/20 dark:text-green-400 dark:border-green-500/30' 
                        : 'bg-slate-200 text-slate-500 border-slate-300 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-400 dark:border-slate-600'
                      }
                    `}
                  >
                    {isLive ? (
                      <>
                        <span className="relative flex h-2.5 w-2.5">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"></span>
                        </span>
                        <span>Live</span>
                        <Wifi size={14} />
                      </>
                    ) : (
                      <>
                        <span className="h-2.5 w-2.5 rounded-full bg-slate-400"></span>
                        <span>Paused</span>
                        <WifiOff size={14} />
                      </>
                    )}
                  </button>
                </div>

                <div className="mt-4 flex items-center gap-4">
                  <span className={`inline-flex items-center px-3 py-1 rounded-lg text-lg font-medium ${
                    isPositive 
                      ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' 
                      : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                  }`}>
                    {isPositive ? <TrendingUp size={20} className="mr-2" /> : <TrendingDown size={20} className="mr-2" />}
                    {Math.abs(percentChange).toFixed(2)}%
                  </span>
                  <span className="text-slate-400 text-lg">per {currentUnit.name}</span>
                </div>
              </div>
            </div>
          </div>
        </Card>

        {/* Chart Section - Full Width */}
        <Card className="p-6 h-[500px] flex flex-col relative">
          <div className="flex flex-col xl:flex-row justify-between items-center mb-8 gap-4">
            <h3 className="font-semibold text-slate-900 dark:text-white flex items-center gap-2 text-lg">
              <Activity className="text-amber-500" />
              Price Trend
              {chartLoading && <RefreshCw size={14} className="animate-spin text-slate-400" />}
            </h3>

            <div className="flex items-center gap-2 w-full xl:w-auto">
               <div className="flex bg-slate-100 dark:bg-slate-900/50 rounded-lg p-1 w-full xl:w-auto overflow-x-auto">
                {TIME_RANGES.map((r) => (
                  <button
                    key={r.label}
                    onClick={() => setTimeRange(r.label)}
                    className={`flex-1 xl:flex-none px-4 py-1.5 rounded-md text-sm font-medium transition-all whitespace-nowrap ${
                      timeRange === r.label
                        ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                        : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
              
              {/* Pan Toggle Button */}
              <button 
                onClick={() => setIsPanMode(!isPanMode)}
                className={`
                   p-2 rounded-lg transition-colors border hidden md:flex items-center gap-2 text-sm font-medium
                   ${isPanMode 
                     ? 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800' 
                     : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700 dark:hover:bg-slate-700'}
                `}
                title={isPanMode ? "Disable Horizontal Scrolling" : "Enable Horizontal Scrolling"}
              >
                <MoveHorizontal size={18} />
                <span className="hidden lg:inline">{isPanMode ? "Pan Active" : "Enable Pan"}</span>
              </button>
            </div>
          </div>

          <div className="flex-1 w-full min-h-0 relative group">
             {/* Horizontal Scroll Wrapper */}
             <div className="absolute inset-0 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-600 scrollbar-track-transparent">
               {/* Inner container determines scroll width. 
                 If isPanMode is true, we force a very large width (e.g. 200%) to enable scrolling.
               */}
               <div 
                  className={`h-full transition-all duration-300 ${isPanMode ? 'min-w-[200%] lg:min-w-[150%]' : 'w-full'}`}
               >
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartHistory} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="#f59e0b" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={darkMode ? "#334155" : "#e2e8f0"} />
                      <XAxis 
                        dataKey="0" 
                        tickFormatter={(unix) => {
                          const date = new Date(unix);
                          return timeRange === '1H' || timeRange === '8H' || timeRange === '24H'
                            ? date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})
                            : date.toLocaleDateString([], {month: 'short', day: 'numeric'});
                        }}
                        stroke="#94a3b8"
                        fontSize={12}
                        tickMargin={10}
                        minTickGap={40}
                        // Increase tick count if in pan mode to show more dates
                        interval={isPanMode ? 0 : 'preserveStartEnd'}
                      />
                      <YAxis 
                        domain={['auto', 'auto']}
                        tickFormatter={(val) => {
                          const scaled = val * currentUnit.multiplier;
                          return new Intl.NumberFormat('en-US', { notation: "compact", compactDisplay: "short" }).format(scaled);
                        }}
                        stroke="#94a3b8"
                        fontSize={12}
                        width={50}
                        // Hide Y-axis when panning because it scrolls out of view anyway
                        hide={isPanMode} 
                      />
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: darkMode ? '#1e293b' : '#fff', 
                          borderColor: darkMode ? '#334155' : '#e2e8f0',
                          borderRadius: '0.75rem',
                          boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'
                        }}
                        itemStyle={{ color: darkMode ? '#e2e8f0' : '#1e293b' }}
                        labelStyle={{ color: '#94a3b8', marginBottom: '0.25rem' }}
                        formatter={(value) => [formatPrice(value * currentUnit.multiplier), 'Price']}
                        labelFormatter={(label) => new Date(label).toLocaleString()}
                      />
                      <Area 
                        type="monotone" 
                        dataKey="1" 
                        stroke="#f59e0b" 
                        strokeWidth={2}
                        fillOpacity={1} 
                        fill="url(#colorPrice)" 
                        animationDuration={1000}
                      />
                      {/* Optional: Add Brush if you wanted a navigator, but CSS scroll is often smoother for mobile */}
                    </AreaChart>
                  </ResponsiveContainer>
               </div>
             </div>
             
             {/* Hint overlay for first-time users or mobile */}
             {!isPanMode && (
                <div className="absolute bottom-2 right-4 text-xs text-slate-400 pointer-events-none md:hidden bg-white/80 dark:bg-slate-900/80 px-2 py-1 rounded shadow backdrop-blur">
                   Enable Pan to scroll history
                </div>
             )}
          </div>
        </Card>
      </main>

      {/* About Modal */}
      <Modal 
        isOpen={showAbout} 
        onClose={() => setShowAbout(false)}
        title="About GoldMace Monitor"
      >
        <div className="space-y-4 text-slate-600 dark:text-slate-300">
          <p>
            Welcome to <strong>GoldMace Monitor</strong>, a professional-grade dashboard for tracking real-time precious metal prices across multiple currencies and measurement units.
          </p>
          
          <h4 className="font-semibold text-slate-900 dark:text-white mt-4">Data Sources</h4>
          <p className="text-sm">
            You can now toggle between two distinct API sources:
          </p>
          <ul className="list-disc list-inside text-sm space-y-1 ml-2">
            <li><strong>PAX Gold (PAXG):</strong> Backed by 1 troy oz of London Good Delivery Gold.</li>
            <li><strong>Tether Gold (XAUt):</strong> A different liquidity pool backed by physical gold in Switzerland.</li>
          </ul>
          <p className="text-sm mt-2">
            Switching sources allows you to cross-verify prices against different market pools.
          </p>

          <h4 className="font-semibold text-slate-900 dark:text-white mt-4">Units Explained</h4>
          <ul className="list-disc list-inside text-sm space-y-1">
            <li><strong>Troy Ounce (oz):</strong> The international standard for gold trading.</li>
            <li><strong>Gram (g):</strong> Common for small jewelry and retail.</li>
            <li><strong>HK Tael (兩):</strong> Traditional unit used in Hong Kong gold markets (~37.429g).</li>
            <li><strong>HK Mace (錢):</strong> 1/10th of a Tael. Often used for pricing jewelry labor or small weights.</li>
          </ul>

          <div className="bg-amber-50 dark:bg-amber-900/20 p-3 rounded-lg mt-4 border border-amber-200 dark:border-amber-800/30">
            <p className="text-xs text-amber-800 dark:text-amber-200 flex items-center gap-2">
              <Info size={16} />
              Disclaimer: Prices are for informational purposes only. Do not use for high-frequency trading.
            </p>
          </div>
        </div>
      </Modal>

    </div>
  );
}