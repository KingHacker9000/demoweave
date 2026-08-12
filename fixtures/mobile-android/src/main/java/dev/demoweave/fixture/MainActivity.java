package dev.demoweave.fixture;

import android.app.Activity;
import android.os.Bundle;
import android.view.View;
import android.view.inputmethod.InputMethodManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.TextView;

public final class MainActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        EditText projectName = findViewById(R.id.project_name);
        Button createButton = findViewById(R.id.create_button);
        TextView result = findViewById(R.id.result);
        createButton.setOnClickListener(view -> {
            String name = projectName.getText().toString();
            result.setText(getString(R.string.result_template, name));
            result.setVisibility(View.VISIBLE);
            projectName.clearFocus();
            InputMethodManager keyboard = getSystemService(InputMethodManager.class);
            if (keyboard != null) keyboard.hideSoftInputFromWindow(projectName.getWindowToken(), 0);
        });
    }
}
