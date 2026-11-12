/**
 * Small, anonymized approximations of job alert emails, written from memory of how the boards lay them out. The real
 * emails change without notice: these pin what the parsers rely on (a link to a posting, then company and location
 * lines), not what any board sends today. Companies and people are made up.
 */
const page = (body: string) =>
  `<!doctype html><html><head><title>Job alert</title><style>.a{color:red}</style><script>window.x = "<a href='https://evil.example/steal'>Hidden Engineer</a>"</script></head><body>${body}</body></html>`

export const LINKEDIN_ALERT = page(`
<table><tr><td><p>Your job alert for software engineer in Berlin</p></td></tr>
<tr><td>
  <a href="https://www.linkedin.com/comm/jobs/view/3912345678?trackingId=abc%3D%3D&amp;refId=r1&amp;midToken=m1&amp;trk=eml-jobalert"><img src="https://media.example/a.png" alt=""></a>
  <a href="https://www.linkedin.com/comm/jobs/view/3912345678?trackingId=abc%3D%3D&amp;refId=r1&amp;trk=eml-jobalert-title">Senior Software Engineer</a>
  <p>Acme Labs · Berlin, Germany</p>
  <p>Be an early applicant</p>
  <a href="https://www.linkedin.com/comm/jobs/view/3912345678?trackingId=abc&amp;trk=eml-jobalert-button">View job</a>
</td></tr>
<tr><td>
  <a href="https://www.linkedin.com/comm/jobs/view/3987654321/?trackingId=def&amp;refId=r2">Backend Developer</a>
  <p>Globex</p>
  <p>Remote</p>
</td></tr>
<tr><td><a href="https://www.linkedin.com/comm/jobs/search?keywords=software%20engineer&amp;trk=eml">See all jobs</a></td></tr>
<tr><td><a href="https://www.linkedin.com/e/v2?e=1&amp;t=unsub">Unsubscribe</a></td></tr></table>`)

export const INDEED_ALERT = page(`
<div><h2>3 new jobs for data analyst</h2>
<div><a href="https://www.indeed.com/rc/clk?jk=a1b2c3d4e5f60718&amp;fccid=9f8e7d6c&amp;vjs=3&amp;tk=1abcdef">Data Analyst</a></div>
<div>Initech - Remote</div>
<div>$70,000 - $90,000 a year</div>
<div><a href="https://www.indeed.com/viewjob?jk=0f1e2d3c4b5a6978&amp;from=alert">Reporting Specialist</a></div>
<div>Hooli</div><div>Austin, TX</div>
<div><a href="https://www.indeed.com/jobs?q=data+analyst&amp;from=alert">See all jobs</a></div>
</div>`)

export const GLASSDOOR_ALERT = page(`
<table><tr><td>
<a href="https://www.glassdoor.com/partner/jobListing.htm?pos=101&amp;ao=1136043&amp;s=224&amp;guid=00&amp;src=GD_JOB_AD&amp;t=SR&amp;jobListingId=1009876543210&amp;jrtk=3-0-x">Product Designer</a>
<p>Umbrella Corp</p><p>Paris</p></td></tr>
<tr><td>
<a href="https://www.glassdoor.com/job-listing/designer-initech-JV_IC1132348_KO0,8_KE9,16.htm?jl=1009123456789&amp;utm_source=alert">Brand Designer</a>
<p>Initech · Lyon</p></td></tr></table>`)

export const WELLFOUND_ALERT = page(`
<div><a href="https://wellfound.com/jobs/3456789-staff-engineer?utm_source=email&amp;utm_medium=alert">Staff Engineer</a>
<div>Hooli</div><div>Remote (US)</div></div>`)

/** A sender the user added: no known layout, so the generic reading applies. */
export const OTHER_ALERT = page(`
<div><p>New roles this week</p>
<a href="https://boards.greenhouse.io/startupco/jobs/4455667?gh_src=email&amp;utm_campaign=weekly&amp;gh_jid=4455667">Platform Engineer</a>
<div>StartupCo</div><div>Lisbon</div>
<a href="https://click.startup.example/ls/click?upn=u001.abcdef">Site Reliability Engineer</a>
<div>StartupCo</div>
<a href="https://startup.example/privacy">Privacy policy</a>
<a href="https://startup.example/unsubscribe?id=1">Unsubscribe</a>
</div>`)

/** Hostile on purpose: a lookalike board, script, javascript: links, bidi and control characters in the text. */
export const HOSTILE_ALERT = (hostile: string) =>
  page(`
<div>
<a href="javascript:alert(1)">Security Engineer</a><div>Evil Corp</div>
<a href="https://www.linkedin.com.evil.example/comm/jobs/view/1234567890">Fake Director</a><div>Evil Corp</div>
<a href="https://www.linkedin.com/comm/jobs/view/5550001112">${hostile}Staff Engineer</a>
<div><img src=x onerror=alert(1)>Initech${hostile}</div>
<div>Remote</div>
</div>`)

export const NEWSLETTER = page(
  `<p>Our weekly digest</p><a href="https://www.linkedin.com/news/story/1">Read the story</a><a href="https://www.linkedin.com/comm/jobs/alerts">Manage your job alerts</a>`,
)
