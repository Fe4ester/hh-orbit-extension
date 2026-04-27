// Setup script to inject test data via chrome.storage
// Run this in Chromium DevTools console (service worker context)

(async () => {
  // Create test profile
  const profileId = 'test-profile-' + Date.now();
  const resumeHash = 'test-resume-hash';

  const state = {
    profiles: {
      [profileId]: {
        id: profileId,
        name: 'Test Profile',
        keywordsInclude: ['python', 'developer'],
        keywordsExclude: [],
        experience: ['noExperience', 'between1And3'],
        schedule: ['remote', 'fullDay'],
        employment: ['full'],
        coverLetterTemplate: 'Здравствуйте, хочу работать у вас.',
        selectedResumeHash: resumeHash,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
    },
    activeProfileId: profileId,
    resumeCandidates: [
      {
        hash: resumeHash,
        title: 'Test Resume',
        source: 'manual',
        lastSeenAt: Date.now(),
      }
    ],
    selectedResumeHash: resumeHash,
    mode: 'live',
  };

  await chrome.storage.local.set(state);
  console.log('Test data injected:', { profileId, resumeHash });
  console.log('Now click Start button in sidepanel');
})();
