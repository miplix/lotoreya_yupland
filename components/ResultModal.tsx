'use client';

interface Props {
  text: string;
  onClose: () => void;
}

export default function ResultModal({ text, onClose }: Props) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="bg-gray-800 border border-gray-600 rounded-xl w-full max-w-lg max-h-[80vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700">
          <h3 className="font-semibold text-gray-100">Результаты розыгрыша</h3>
          <button
            className="text-gray-400 hover:text-gray-100 text-xl leading-none transition-colors"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        <pre className="flex-1 overflow-y-auto p-5 text-sm text-gray-200 whitespace-pre-wrap font-mono leading-relaxed">
          {text}
        </pre>
        <div className="px-5 py-3 border-t border-gray-700">
          <button
            className="w-full py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm transition-colors"
            onClick={onClose}
          >
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}
