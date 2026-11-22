const key = courseId => 'yamori-progress:' + courseId;

export function completedLessons(courseId) {
  try {
    const raw = localStorage.getItem(key(courseId));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function isComplete(courseId, file) {
  return completedLessons(courseId).includes(file);
}

export function setComplete(courseId, file, done) {
  const set = new Set(completedLessons(courseId));
  if (done) set.add(file);
  else set.delete(file);
  localStorage.setItem(key(courseId), JSON.stringify([...set]));
}

export function progressCounts(course) {
  const done = completedLessons(course.id);
  const total = course.steps.length;
  const finished = course.steps.filter(step => done.includes(step.file)).length;
  return { finished, total, done };
}