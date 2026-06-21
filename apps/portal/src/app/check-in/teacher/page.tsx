import { notFound } from 'next/navigation';
import Link from 'next/link';
import { listClasses, getRosterWithContacts } from '@/features/check-in/shared';
import { TeacherCheckInList } from '@/features/check-in/teacher/teacher-check-in-list';
import { flags } from '@/lib/flags';

export const metadata = { title: 'Student Check-in' };

function todayYMD(): string {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Toronto' }));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface Props {
  searchParams: Promise<{ classId?: string; date?: string }>;
}

export default async function TeacherCheckInPage({ searchParams }: Props) {
  if (!flags.checkInTeacher) notFound();

  const params = await searchParams;
  const classes = await listClasses();
  const selectedClassId = params.classId ?? '';
  const selectedDate = params.date ?? todayYMD();

  const roster = selectedClassId ? await getRosterWithContacts(selectedClassId) : null;

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6">
      {/* Header */}
      <div className="max-w-4xl mx-auto mb-8">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center mb-4">
          <div className="mb-4 sm:mb-0">
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Student Check-in</h1>
            <p className="text-gray-600">Select a class level and date to manage student attendance</p>
          </div>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <Link
              href="/check-in/teacher/check-in-report"
              className="inline-flex items-center justify-center px-3 py-2 text-sm font-medium text-blue-700 bg-blue-50 rounded-md hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 whitespace-nowrap"
            >
              Check-in Reports
            </Link>
            <Link
              href="/check-in/teacher/uninformed"
              className="inline-flex items-center justify-center px-3 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-400 whitespace-nowrap"
            >
              Uninformed Absentees
            </Link>
            <form action="/api/auth/signout" method="post">
              <button
                type="submit"
                className="w-full sm:w-auto px-3 py-2 text-sm font-medium text-red-700 bg-red-50 rounded-md hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </div>

      {/* Class + Date selectors (form submits via GET to update searchParams) */}
      <div className="max-w-4xl mx-auto bg-white rounded-lg shadow-sm p-6 mb-8">
        <form method="GET" action="/check-in/teacher" className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="classId" className="block text-sm font-medium text-gray-700 mb-2">
              Class Level
            </label>
            <select
              id="classId"
              name="classId"
              defaultValue={selectedClassId}
              className="w-full p-2.5 border border-gray-300 rounded-md text-gray-900 bg-white"
            >
              <option value="">Select a level</option>
              {classes.map((c) => (
                <option key={c.classId} value={c.classId}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="date" className="block text-sm font-medium text-gray-700 mb-2">
              Date
            </label>
            <input
              id="date"
              name="date"
              type="date"
              defaultValue={selectedDate}
              className="w-full p-2.5 border border-gray-300 rounded-md text-gray-900 bg-white"
            />
          </div>
          <div className="md:col-span-2 flex justify-end">
            <button
              type="submit"
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              Load students
            </button>
          </div>
        </form>
      </div>

      {/* Student list — only when a class is selected */}
      {selectedClassId && (
        <div className="max-w-4xl mx-auto">
          {roster ? (
            <>
              <h2 className="text-xl font-semibold text-gray-900 mb-4">
                {roster.name} &mdash; {selectedDate}
              </h2>
              <TeacherCheckInList
                students={roster.students}
                classId={selectedClassId}
                date={selectedDate}
                initialCheckedSids={[]}
              />
            </>
          ) : (
            <div className="bg-white rounded-lg shadow-sm p-6 text-center text-gray-500">
              Class not found or no students enrolled.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
