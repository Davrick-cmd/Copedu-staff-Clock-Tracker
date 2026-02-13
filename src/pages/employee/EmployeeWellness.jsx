import { motion } from 'framer-motion';

const LINKS = [
  { title: 'Wellness resources', url: 'https://www.who.int/health-topics/mental-health', description: 'Mental health and wellness guidance' },
  { title: 'Company news', url: '#', description: 'Internal news (placeholder)' },
];

export function EmployeeWellness() {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Wellness & News</h1>
      <p className="text-gray-600 dark:text-gray-400">Useful links for wellness and company updates.</p>
      <div className="grid gap-4 md:grid-cols-2">
        {LINKS.map((link) => (
          <a
            key={link.title}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block p-4 bg-white dark:bg-gray-800 rounded-xl shadow hover:shadow-md transition-shadow border border-gray-200 dark:border-gray-700"
          >
            <h2 className="font-semibold text-primary-600 dark:text-primary-400">{link.title}</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{link.description}</p>
          </a>
        ))}
      </div>
    </motion.div>
  );
}
