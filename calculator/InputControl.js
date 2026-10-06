// 'import React'와 'export' 키워드를 모두 삭제합니다.

// --- From components/InputControl.tsx ---
const InputControl = ({ label, name, value, onChange, unit, placeholder, icon, onKeyDown, type = "number" }) => { // Added type prop
  return (
    <div>
      <label htmlFor={name} className="block text-sm font-medium text-gray-700 mb-1">
        {label}
      </label>
      <div className="relative">
        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
          {icon}
        </div>
        <input
          type={type} // Use type prop
          id={name}
          name={name}
          value={value}
          onChange={onChange}
          onKeyDown={onKeyDown}
          placeholder={placeholder || "0"}
          // Added step="any" for potential decimal inputs, adjusted padding
          step={type === "number" ? "any" : undefined} 
          className="w-full rounded-md border-gray-300 py-2 pl-10 pr-12 sm:pr-16 shadow-sm focus:border-emerald-500 focus:ring-emerald-500 sm:text-sm"
        />
        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
          <span className="text-gray-500 sm:text-sm">{unit}</span>
        </div>
      </div>
    </div>
  );
};