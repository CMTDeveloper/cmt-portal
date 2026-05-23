export const mockFamily = {
  fid: 4421,
  legacyFid: null,
  name: 'Patel',
  location: 'Brampton',
  joinedYear: 2019,
  members: [
    { mid: '4421-01', name: 'Aarti Patel', type: 'Adult' as const, age: 36, email: 'aarti.patel@gmail.com', phone: '(416) 555-3387', manager: true,  role: 'Volunteer · Teaching', allergy: null, grade: null },
    { mid: '4421-02', name: 'Raj Patel',   type: 'Adult' as const, age: 38, email: 'raj.patel@gmail.com',   phone: '(416) 555-2204', manager: false, role: 'Volunteer · AV',      allergy: null, grade: null },
    { mid: '4421-03', name: 'Diya Patel',  type: 'Child' as const, age: 8,  email: null, phone: null, manager: false, role: null, allergy: { summary: 'Peanuts', severity: 'severe', detail: 'EpiPen carried in lunch bag. Teachers alerted.' }, grade: 'Grade 3' },
    { mid: '4421-04', name: 'Arjun Patel', type: 'Child' as const, age: 6,  email: null, phone: null, manager: false, role: null, allergy: null, grade: 'Grade 1' },
  ],
};

export const mockDonations = [
  { year: '2026', items: [{ date: '14 Jun', title: "Bala Vihar · Fall '26", amount: 500, method: 'Card · ••4242' }] },
  { year: '2025', items: [
    { date: '02 Sep', title: "Bala Vihar · Fall '25",   amount: 450, method: 'e-Transfer' },
    { date: '12 Jan', title: "Bala Vihar · Spring '25", amount: 450, method: 'Card · ••4242' },
  ]},
  { year: '2024', items: [
    { date: '09 Sep', title: "Bala Vihar · Fall '24",   amount: 400, method: 'Cheque' },
    { date: '14 Feb', title: "Bala Vihar · Spring '24", amount: 400, method: 'e-Transfer' },
  ]},
];

export const mockEnrollment = {
  program: 'Bala Vihar · Fall 2026',
  schedule: 'Sundays 10 AM – 12 PM · 16 weeks · Brampton hall',
  suggestedDonation: 500,
  children: [
    { mid: '4421-03', name: 'Diya Patel',  grade: 'Grade 3', className: 'Grade 3 class · Mira Aunty' },
    { mid: '4421-04', name: 'Arjun Patel', grade: 'Grade 1', className: 'Grade 1 class · Priya Aunty' },
  ],
};
