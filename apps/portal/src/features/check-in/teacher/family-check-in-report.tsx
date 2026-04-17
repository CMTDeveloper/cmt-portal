'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import Link from 'next/link';

interface FamilyEntry {
  name: string;
  checkIns: Record<string, boolean>;
}

interface ReportData {
  families: Record<string, FamilyEntry>;
  dates: string[];
  totalFamilies: number;
  centers: string[];
}

function getLastSevenMonths(): Array<{ value: string; label: string }> {
  const months = [];
  const now = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleDateString('en-CA', { month: 'long', year: 'numeric' });
    months.push({ value, label });
  }
  return months;
}

function formatSunday(date: string): string {
  const day = parseInt(date.split('-')[2] ?? '0', 10);
  return `SUN ${day}`;
}

const ITEMS_PER_PAGE = 25;

export function FamilyCheckInReport() {
  const availableMonths = useMemo(() => getLastSevenMonths(), []);
  const [center, setCenter] = useState('');
  const [month, setMonth] = useState(availableMonths[0]?.value ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ReportData | null>(null);
  const [centers, setCenters] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState(1);

  const fetchReport = useCallback(async (selectedCenter: string, selectedMonth: string) => {
    if (!selectedCenter) return;
    setLoading(true);
    setError(null);
    setCurrentPage(1);
    try {
      const res = await fetch(
        `/api/check-in/teacher/check-in-report?center=${encodeURIComponent(selectedCenter)}&month=${encodeURIComponent(selectedMonth)}`,
      );
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const json = (await res.json()) as ReportData;
      setData(json);
      if (json.centers.length > 0) setCenters(json.centers);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch centers on mount using the first available month
  useEffect(() => {
    // We can't get centers without a center param; populate from first successful fetch
  }, []);

  function handleCenterChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const val = e.target.value;
    setCenter(val);
    if (val) void fetchReport(val, month);
  }

  function handleMonthChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const val = e.target.value;
    setMonth(val);
    if (center) void fetchReport(center, val);
  }

  const sortedFamilies = useMemo(() => {
    if (!data) return [];
    return Object.entries(data.families).sort(([, a], [, b]) =>
      a.name.localeCompare(b.name),
    );
  }, [data]);

  const totalPages = Math.ceil(sortedFamilies.length / ITEMS_PER_PAGE);
  const pageFamilies = sortedFamilies.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE,
  );

  const pageNumbers = useMemo(() => {
    const max = 5;
    if (totalPages <= max) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const half = Math.floor(max / 2);
    let start = Math.max(1, currentPage - half);
    if (start + max - 1 > totalPages) start = totalPages - max + 1;
    return Array.from({ length: max }, (_, i) => start + i);
  }, [currentPage, totalPages]);

  const dates = data?.dates ?? [];

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6">
      {/* Header */}
      <div className="max-w-7xl mx-auto mb-6">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4">
          <div className="flex-1">
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-1">
              Sunday Attendance Overview
            </h1>
            {data && data.totalFamilies > 0 && (
              <p className="text-sm text-gray-600 font-medium">
                {data.totalFamilies} families &bull; {dates.length} Sundays
              </p>
            )}
          </div>
          <Link
            href="/check-in/teacher"
            className="inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-blue-700 bg-blue-50 rounded-md hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 self-start"
          >
            Back to Check-in
          </Link>
        </div>
      </div>

      {/* Filters */}
      <div className="max-w-7xl mx-auto bg-white rounded-lg shadow-sm p-4 sm:p-6 mb-6">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1">
            <label htmlFor="center" className="block text-sm font-medium text-gray-700 mb-2">
              Center
            </label>
            <select
              id="center"
              value={center}
              onChange={handleCenterChange}
              className="w-full p-2.5 border border-gray-300 rounded-md text-gray-900 bg-white"
            >
              <option value="">Select a center</option>
              {(centers.length > 0 ? centers : ['Brampton', 'Scarborough']).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1">
            <label htmlFor="month" className="block text-sm font-medium text-gray-700 mb-2">
              Month
            </label>
            <select
              id="month"
              value={month}
              onChange={handleMonthChange}
              className="w-full p-2.5 border border-gray-300 rounded-md text-gray-900 bg-white"
            >
              {availableMonths.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="max-w-7xl mx-auto text-center py-12">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-gray-200 border-t-indigo-600 mb-3" />
          <p className="text-gray-600 text-sm">Loading check-in data...</p>
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div className="max-w-7xl mx-auto bg-red-50 border border-red-200 p-4 rounded-md mb-4">
          <p className="text-red-800 text-sm">{error}</p>
        </div>
      )}

      {/* Empty prompt */}
      {!center && !loading && (
        <div className="max-w-7xl mx-auto bg-white rounded-lg shadow-sm p-8 text-center text-gray-500 text-sm">
          Select a center to load attendance data.
        </div>
      )}

      {/* Table */}
      {center && data && !loading && (
        <div className="max-w-7xl mx-auto mb-8">
          <div className="bg-white rounded-lg shadow-sm">
            {/* No check-ins notice */}
            {sortedFamilies.length > 0 &&
              !sortedFamilies.some(([, f]) => dates.some((d) => f.checkIns[d])) && (
                <div className="p-4 bg-blue-50 border-b border-blue-100 rounded-t-lg">
                  <p className="text-sm text-blue-700">
                    No check-ins found for these dates. A green checkmark will appear when a
                    family has been checked in.
                  </p>
                </div>
              )}

            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th
                      scope="col"
                      className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider sticky left-0 bg-gray-50 z-10 border-r border-gray-200"
                      style={{ minWidth: '160px' }}
                    >
                      Family
                    </th>
                    {dates.map((date) => (
                      <th
                        key={date}
                        scope="col"
                        className="px-2 sm:px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap"
                        style={{ minWidth: '60px' }}
                      >
                        {formatSunday(date)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {pageFamilies.map(([fid, family], index) => (
                    <tr key={fid} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td
                        className="px-4 sm:px-6 py-3 sm:py-4 text-sm font-medium text-gray-900 sticky left-0 border-r border-gray-200 truncate max-w-[160px] sm:max-w-none"
                        style={{ backgroundColor: index % 2 === 0 ? 'white' : '#f9fafb' }}
                        title={family.name}
                      >
                        {family.name}
                      </td>
                      {dates.map((date) => {
                        const checked = family.checkIns[date] === true;
                        return (
                          <td
                            key={`${fid}-${date}`}
                            className="px-2 sm:px-4 py-3 sm:py-4 text-center"
                          >
                            {checked ? (
                              <div className="flex items-center justify-center">
                                <div className="w-5 h-5 sm:w-6 sm:h-6 flex items-center justify-center bg-green-100 text-green-800 rounded-sm border border-green-400">
                                  <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    className="h-3 w-3 sm:h-4 sm:w-4"
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    stroke="currentColor"
                                  >
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      strokeWidth={2}
                                      d="M5 13l4 4L19 7"
                                    />
                                  </svg>
                                </div>
                              </div>
                            ) : (
                              <div className="w-5 h-5 sm:w-6 sm:h-6 mx-auto" />
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  {sortedFamilies.length === 0 && (
                    <tr>
                      <td
                        colSpan={dates.length + 1}
                        className="px-6 py-10 text-center text-sm text-gray-500"
                      >
                        No family records found for this center and month.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Legend */}
            <div className="px-4 sm:px-6 py-4 border-t border-gray-200 bg-gray-50">
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 flex items-center justify-center bg-green-100 text-green-800 rounded-sm border border-green-400">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-3 w-3"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  </div>
                  <span className="text-sm text-gray-700">Present</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 bg-white border border-gray-300 rounded-sm" />
                  <span className="text-sm text-gray-700">Absent</span>
                </div>
              </div>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="px-4 sm:px-6 py-4 border-t border-gray-200">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <p className="text-sm text-gray-700">
                    Showing{' '}
                    <span className="font-medium">
                      {(currentPage - 1) * ITEMS_PER_PAGE + 1}
                    </span>{' '}
                    to{' '}
                    <span className="font-medium">
                      {Math.min(currentPage * ITEMS_PER_PAGE, sortedFamilies.length)}
                    </span>{' '}
                    of <span className="font-medium">{sortedFamilies.length}</span> families
                  </p>
                  <div className="flex items-center space-x-1">
                    <button
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                      className={`px-3 py-2 text-sm rounded-md ${currentPage === 1 ? 'text-gray-400 cursor-not-allowed' : 'text-gray-700 hover:bg-gray-100'}`}
                      aria-label="Previous page"
                    >
                      &laquo;
                    </button>
                    {pageNumbers.map((n) => (
                      <button
                        key={n}
                        onClick={() => setCurrentPage(n)}
                        className={`px-3 py-2 text-sm rounded-md min-w-[36px] ${n === currentPage ? 'bg-blue-100 text-blue-700 font-medium' : 'text-gray-700 hover:bg-gray-100'}`}
                      >
                        {n}
                      </button>
                    ))}
                    <button
                      onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages}
                      className={`px-3 py-2 text-sm rounded-md ${currentPage === totalPages ? 'text-gray-400 cursor-not-allowed' : 'text-gray-700 hover:bg-gray-100'}`}
                      aria-label="Next page"
                    >
                      &raquo;
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
