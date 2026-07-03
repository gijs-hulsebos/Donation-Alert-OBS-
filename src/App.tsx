import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Twitter, Send, MessageSquare } from 'lucide-react';

interface AlertData {
  id: string;
  amount: string;
  name: string;
  comment: string | null;
  socials: {
    x?: string;
    discord?: string;
    telegram?: string;
  };
}

export default function App() {
  const SPREADSHEET_ID = '1gTvI06x72BgZTojVukeEcMlf6IH-5vXtGNndsshKBZE';
  const FETCH_URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json`;

  const [activeAlert, setActiveAlert] = useState<AlertData | null>(null);
  const [lastSeenTimestamp, setLastSeenTimestamp] = useState<string | null>(null);
  const [isInitialMount, setIsInitialMount] = useState<boolean>(true);

  // Use refs to avoid closure stale state in useEffect interval
  const lastSeenTimestampRef = useRef<string | null>(null);
  const isInitialMountRef = useRef<boolean>(true);
  const activeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    lastSeenTimestampRef.current = lastSeenTimestamp;
  }, [lastSeenTimestamp]);

  useEffect(() => {
    isInitialMountRef.current = isInitialMount;
  }, [isInitialMount]);

  // Safe helper to extract cell value, supporting both formatted display value (f) and raw value (v)
  const getCellValue = (row: any, index: number): string => {
    if (!row || !row.c) return '';
    const cell = row.c[index];
    if (!cell) return '';
    // Prefer formatted value cell.f if present, otherwise raw value cell.v
    if (cell.f !== undefined && cell.f !== null) return String(cell.f).trim();
    if (cell.v !== undefined && cell.v !== null) return String(cell.v).trim();
    return '';
  };

  // Maps row arrays into our AlertData object
  const parseRowToAlert = (row: any, rowIndex: number): AlertData | null => {
    const rawTimestamp = getCellValue(row, 1); // Index 1: Timestamp
    const amount = getCellValue(row, 2); // Index 2: Amount
    const rawName = getCellValue(row, 5); // Index 5: Name
    const name = rawName ? rawName : 'Anonymous'; // Fallback natively to 'Anonymous'
    const rawComment = getCellValue(row, 6); // Index 6: Comment (Optional)
    const comment = rawComment ? rawComment : null;

    const x = getCellValue(row, 7); // Index 7: X (Twitter)
    const discord = getCellValue(row, 8); // Index 8: Discord
    const telegram = getCellValue(row, 9); // Index 9: Telegram

    const socials: AlertData['socials'] = {};
    if (x) socials.x = x;
    if (discord) socials.discord = discord;
    if (telegram) socials.telegram = telegram;

    // Construct a highly robust unique tracking ID
    // If we have a timestamp, we combine it with the row index so duplicate timestamps still trigger separate alerts.
    // If we don't have a timestamp, we fallback to a synthetic ID using row index + name + amount.
    const id = rawTimestamp 
      ? `${rawTimestamp}_${rowIndex}` 
      : `synthetic_${rowIndex}_${name}_${amount}`;

    return {
      id,
      amount,
      name,
      comment,
      socials,
    };
  };

  useEffect(() => {
    let isSubscribed = true;

    const fetchLatestAlert = async () => {
      try {
        const res = await fetch(FETCH_URL);
        if (!res.ok) return;
        const text = await res.text();

        // Strip Google's native JSON function wrapper /*O_o*/...
        const startIdx = text.indexOf('{');
        const endIdx = text.lastIndexOf('}');
        if (startIdx === -1 || endIdx === -1) return;

        const cleanJsonText = text.substring(startIdx, endIdx + 1);
        const parsedData = JSON.parse(cleanJsonText);

        const rows = parsedData?.table?.rows;
        if (!rows || !Array.isArray(rows) || rows.length === 0) return;

        // Filter and map all row items that have some actual data (Amount, Name, Comment, or Timestamp)
        // keeping track of their original spreadsheet index
        const validRowEntries = rows
          .map((row: any, idx: number) => ({ row, idx }))
          .filter(({ row }) => {
            if (!row || !row.c) return false;
            const timestamp = getCellValue(row, 1);
            const amount = getCellValue(row, 2);
            const name = getCellValue(row, 5);
            const comment = getCellValue(row, 6);
            // It's a valid row if it has any key donation cell filled
            return timestamp !== '' || amount !== '' || name !== '' || comment !== '';
          });

        if (validRowEntries.length === 0 || !isSubscribed) return;

        // The very latest valid row in the spreadsheet
        const latestEntry = validRowEntries[validRowEntries.length - 1];
        const latestAlert = parseRowToAlert(latestEntry.row, latestEntry.idx);
        if (!latestAlert) return;

        const liveId = latestAlert.id;
        const currentSavedId = lastSeenTimestampRef.current;

        if (isInitialMountRef.current) {
          // Anti-Spam Filter: Lock in last row ID on mount without displaying alert
          lastSeenTimestampRef.current = liveId;
          setLastSeenTimestamp(liveId);
          setIsInitialMount(false);
          isInitialMountRef.current = false;
        } else if (currentSavedId !== null && liveId !== currentSavedId) {
          // Subsequent polls: trigger if the tracking key changes (newer donation row added)
          lastSeenTimestampRef.current = liveId;
          setLastSeenTimestamp(liveId);
          
          if (activeTimeoutRef.current) {
            clearTimeout(activeTimeoutRef.current);
          }

          setActiveAlert(latestAlert);

          // Trigger a 6-second timeout to reset the alert back to null
          activeTimeoutRef.current = setTimeout(() => {
            if (isSubscribed) {
              setActiveAlert(null);
            }
          }, 6000);
        }
      } catch (error) {
        console.error('Failed to poll donation sheet:', error);
      }
    };

    // Immediate first check
    fetchLatestAlert();

    // Standard 3-second polling interval
    const intervalId = setInterval(fetchLatestAlert, 3000);

    return () => {
      isSubscribed = false;
      clearInterval(intervalId);
      if (activeTimeoutRef.current) {
        clearTimeout(activeTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div 
      className="fixed inset-0 w-screen h-screen bg-transparent overflow-hidden pointer-events-none flex items-start justify-center pt-20"
      id="obs-overlay-canvas"
    >
      <AnimatePresence mode="wait">
        {activeAlert && (
          <motion.div
            key={activeAlert.id}
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10, transition: { duration: 0.2 } }}
            transition={{ type: 'spring', stiffness: 260, damping: 20 }}
            className="flex flex-col items-center justify-center text-center max-w-xl px-6 py-4 pointer-events-auto select-none"
            style={{ textShadow: '0 2px 10px rgba(0, 0, 0, 0.9), 0 1px 3px rgba(0, 0, 0, 0.9)' }}
          >
            {/* Header Line */}
            <div className="text-xl md:text-2xl font-sans tracking-wide leading-snug">
              <span className="font-semibold text-white">
                {activeAlert.name}
              </span>
              <span className="mx-2 text-neutral-300 font-normal">
                donated
              </span>
              <span className="font-bold text-emerald-400">
                {activeAlert.amount}
              </span>
            </div>

            {/* Comment Block */}
            {activeAlert.comment && (
              <motion.p
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 }}
                className="mt-2 text-sm md:text-base text-neutral-200 italic font-sans max-w-lg leading-relaxed break-words font-medium"
              >
                &ldquo;{activeAlert.comment}&rdquo;
              </motion.p>
            )}

            {/* Social Handles */}
            {(activeAlert.socials.x || activeAlert.socials.discord || activeAlert.socials.telegram) && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.3 }}
                className="mt-3 flex items-center justify-center gap-4 text-xs text-neutral-400 font-sans tracking-wider"
              >
                {activeAlert.socials.x && (
                  <span className="flex items-center gap-1">
                    <Twitter size={11} className="text-neutral-400" />
                    <span>{activeAlert.socials.x}</span>
                  </span>
                )}
                {activeAlert.socials.discord && (
                  <span className="flex items-center gap-1">
                    <MessageSquare size={11} className="text-neutral-400" />
                    <span>{activeAlert.socials.discord}</span>
                  </span>
                )}
                {activeAlert.socials.telegram && (
                  <span className="flex items-center gap-1">
                    <Send size={11} className="text-neutral-400" />
                    <span>{activeAlert.socials.telegram}</span>
                  </span>
                )}
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
