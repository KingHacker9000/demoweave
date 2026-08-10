'use client';

import { useState, type FormEvent } from 'react';

type Project = {
  name: string;
  description: string;
  accent: string;
  initials: string;
};

const existingProjects: Project[] = [
  {
    name: 'Website refresh',
    description: 'Polish the launch pages and handoff notes.',
    accent: 'violet',
    initials: 'WR',
  },
  {
    name: 'API integration',
    description: 'Connect the customer workspace to reporting.',
    accent: 'blue',
    initials: 'AI',
  },
];

export default function Page() {
  const [creating, setCreating] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [createdProject, setCreatedProject] = useState<Project | null>(null);

  function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = projectName.trim();
    if (!name) return;

    setCreatedProject({
      name,
      description: 'A focused workspace for the next product launch.',
      accent: 'green',
      initials: 'LD',
    });
    setCreating(false);
  }

  return (
    <main className="shell">
      <aside className="sidebar" aria-label="Primary navigation">
        <a className="brand" href="#dashboard" aria-label="Northstar home">
          <span className="brandMark" aria-hidden="true">N</span>
          <span>Northstar</span>
        </a>
        <nav aria-label="Workspace">
          <a className="navItem active" href="#dashboard" aria-current="page">
            <span aria-hidden="true">⌂</span> Dashboard
          </a>
          <a className="navItem" href="#projects"><span aria-hidden="true">□</span> Projects</a>
          <a className="navItem" href="#team"><span aria-hidden="true">◇</span> Team</a>
        </nav>
        <div className="sidebarFooter">
          <span className="avatar" aria-hidden="true">AK</span>
          <span><strong>Alex Kim</strong><small>Product team</small></span>
        </div>
      </aside>

      <section className="workspace" id="dashboard" aria-labelledby="dashboard-title">
        <header className="topbar">
          <div>
            <p className="eyebrow">Monday workspace</p>
            <h1 id="dashboard-title">Dashboard</h1>
          </div>
          <button
            className="primaryButton"
            type="button"
            aria-label="New project"
            onClick={() => setCreating(true)}
          >
            <span aria-hidden="true">+</span> New project
          </button>
        </header>

        {createdProject && (
          <div className="successNotice" role="status" data-automation-id="project-result">
            <span className="successIcon" aria-hidden="true">✓</span>
            <span><strong>{createdProject.name}</strong> was created and is ready for your team.</span>
          </div>
        )}

        <section className="overview" aria-label="Workspace overview">
          <article><span>Active projects</span><strong>{createdProject ? '3' : '2'}</strong><small>Across one workspace</small></article>
          <article><span>Tasks in progress</span><strong>12</strong><small>Four due this week</small></article>
          <article><span>Team members</span><strong>8</strong><small>Everyone has access</small></article>
        </section>

        <section className="projects" id="projects" aria-labelledby="projects-title">
          <div className="sectionHeading">
            <div>
              <h2 id="projects-title">Recent projects</h2>
              <p>Keep product work visible and moving.</p>
            </div>
            <a href="#projects">View all</a>
          </div>

          {creating && (
            <form className="createPanel" onSubmit={createProject} data-testid="project-form">
              <div>
                <h3>Create a project</h3>
                <p>Give the workspace a clear, memorable name.</p>
              </div>
              <div className="field">
                <label htmlFor="project-name">Project name</label>
                <input
                  id="project-name"
                  data-testid="project-name"
                  name="projectName"
                  value={projectName}
                  onChange={(event) => setProjectName(event.target.value)}
                  autoComplete="off"
                  placeholder="e.g. Launch plan"
                />
              </div>
              <div className="formActions">
                <button className="secondaryButton" type="button" onClick={() => setCreating(false)}>Cancel</button>
                <button className="primaryButton" type="submit" aria-label="Create project">Create project</button>
              </div>
            </form>
          )}

          <div className="projectGrid">
            {[...(createdProject ? [createdProject] : []), ...existingProjects].map((project) => (
              <article className={`projectCard ${project.accent}`} key={project.name} data-testid={project === createdProject ? 'created-project' : undefined}>
                <div className="projectIcon" aria-hidden="true">{project.initials}</div>
                <span className="status"><i aria-hidden="true" /> Active</span>
                <h3>{project.name}</h3>
                <p>{project.description}</p>
                <footer><span>Product</span><span aria-label="3 collaborators" className="collaborators"><i>AK</i><i>JR</i><i>+</i></span></footer>
              </article>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}
