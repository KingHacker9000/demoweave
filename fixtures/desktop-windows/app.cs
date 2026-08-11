using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using System.Runtime.InteropServices;

namespace DemoWeaveDesktopFixture
{
    internal static class Program
    {
        [DllImport("user32.dll")]
        private static extern bool SetProcessDPIAware();

        [STAThread]
        private static void Main()
        {
            SetProcessDPIAware();
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new FixtureForm());
        }
    }

    internal sealed class FixtureForm : Form
    {
        private readonly TextBox projectName;
        private readonly Label result;

        internal FixtureForm()
        {
            Name = "demoweave-desktop-fixture";
            Text = "DemoWeave Desktop Fixture";
            ClientSize = new Size(640, 450);
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            BackColor = Color.FromArgb(245, 247, 251);
            Font = new Font("Segoe UI", 10f);

            var header = new Panel { Dock = DockStyle.Top, Height = 126, BackColor = Color.FromArgb(31, 41, 55) };
            Controls.Add(header);
            header.Controls.Add(new Label {
                AutoSize = true, Location = new Point(32, 20), ForeColor = Color.FromArgb(147, 197, 253),
                Font = new Font("Segoe UI Semibold", 9f), Text = "WINDOWS UI AUTOMATION PROOF"
            });
            header.Controls.Add(new Label {
                AutoSize = false, Location = new Point(32, 42), Size = new Size(560, 44), ForeColor = Color.White,
                Font = new Font("Segoe UI Semibold", 20f), Text = "Create a project"
            });
            header.Controls.Add(new Label {
                AutoSize = true, Location = new Point(34, 94), ForeColor = Color.FromArgb(209, 213, 219),
                Text = "A small native fixture driven entirely through semantic controls."
            });

            var card = new Panel {
                Location = new Point(32, 152), Size = new Size(576, 260), BackColor = Color.White,
                BorderStyle = BorderStyle.FixedSingle
            };
            Controls.Add(card);
            card.Controls.Add(new Label {
                AutoSize = true, Location = new Point(24, 22), ForeColor = Color.FromArgb(55, 65, 81),
                Font = new Font("Segoe UI Semibold", 10f), Text = "Project name"
            });

            projectName = new TextBox {
                Name = "project-name", AccessibleName = "Project name", Location = new Point(28, 50),
                Size = new Size(340, 30), Font = new Font("Segoe UI", 11f)
            };
            card.Controls.Add(projectName);

            var create = new Button {
                Name = "create-button", AccessibleName = "Create project", Location = new Point(388, 48),
                Size = new Size(156, 34), FlatStyle = FlatStyle.Flat, BackColor = Color.FromArgb(37, 99, 235),
                ForeColor = Color.White, Font = new Font("Segoe UI Semibold", 10f), Text = "Create project"
            };
            create.FlatAppearance.BorderSize = 0;
            create.Click += CreateProject;
            card.Controls.Add(create);

            card.Controls.Add(new Label {
                Location = new Point(28, 104), Size = new Size(516, 1), BackColor = Color.FromArgb(229, 231, 235)
            });
            card.Controls.Add(new Label {
                AutoSize = true, Location = new Point(28, 126), ForeColor = Color.FromArgb(107, 114, 128), Text = "Result"
            });

            result = new Label {
                Name = "result-text", AccessibleName = "Project result", Location = new Point(28, 154),
                Size = new Size(516, 62), Padding = new Padding(14, 12, 14, 12),
                BackColor = Color.FromArgb(236, 253, 245), ForeColor = Color.FromArgb(6, 95, 70),
                Font = new Font("Segoe UI Semibold", 10f), Visible = false
            };
            card.Controls.Add(result);
        }

        private void CreateProject(object sender, EventArgs args)
        {
            var dataPath = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", "fixture-data.json"));
            var data = new JavaScriptSerializer().Deserialize<Dictionary<string, string>>(File.ReadAllText(dataPath));
            var name = projectName.Text.Trim();
            if (name.Length == 0) name = "Untitled project";
            result.Text = data["resultPrefix"] + " " + name;
            result.AccessibleName = result.Text;
            result.Visible = true;
        }
    }
}
