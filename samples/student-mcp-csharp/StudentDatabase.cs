using Microsoft.Data.Sqlite;

public sealed class StudentDatabase
{
    private readonly string _connectionString;

    public StudentDatabase(string databasePath)
    {
        var builder = new SqliteConnectionStringBuilder
        {
            DataSource = databasePath
        };

        _connectionString = builder.ToString();
    }

    public async Task InitializeAsync()
    {
        await using var connection = CreateConnection();
        await connection.OpenAsync();

        var command = connection.CreateCommand();
        command.CommandText = """
            CREATE TABLE IF NOT EXISTS students (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                class_name TEXT NOT NULL,
                roll_no TEXT NOT NULL,
                email TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS subjects (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS exam_marks (
                id INTEGER PRIMARY KEY,
                student_id INTEGER NOT NULL,
                subject_id INTEGER NOT NULL,
                exam_name TEXT NOT NULL,
                marks INTEGER NOT NULL,
                max_marks INTEGER NOT NULL,
                UNIQUE(student_id, subject_id, exam_name),
                FOREIGN KEY(student_id) REFERENCES students(id),
                FOREIGN KEY(subject_id) REFERENCES subjects(id)
            );

            INSERT OR IGNORE INTO students (id, name, class_name, roll_no, email) VALUES
                (1, 'Rahul Nair', '8A', '8A-01', 'rahul@example.com'),
                (2, 'Anjali Menon', '8A', '8A-02', 'anjali@example.com'),
                (3, 'Meera Iyer', '8B', '8B-01', 'meera@example.com'),
                (4, 'Arjun Kumar', '8B', '8B-02', 'arjun@example.com');

            INSERT OR IGNORE INTO subjects (id, name) VALUES
                (1, 'Mathematics'),
                (2, 'Science'),
                (3, 'English');

            INSERT OR IGNORE INTO exam_marks (id, student_id, subject_id, exam_name, marks, max_marks) VALUES
                (1, 1, 1, 'Midterm', 82, 100),
                (2, 1, 2, 'Midterm', 76, 100),
                (3, 1, 3, 'Midterm', 88, 100),
                (4, 2, 1, 'Midterm', 43, 100),
                (5, 2, 2, 'Midterm', 67, 100),
                (6, 2, 3, 'Midterm', 72, 100),
                (7, 3, 1, 'Midterm', 91, 100),
                (8, 3, 2, 'Midterm', 84, 100),
                (9, 3, 3, 'Midterm', 79, 100),
                (10, 4, 1, 'Midterm', 35, 100),
                (11, 4, 2, 'Midterm', 58, 100),
                (12, 4, 3, 'Midterm', 64, 100);
            """;

        await command.ExecuteNonQueryAsync();
    }

    public SqliteConnection CreateConnection() => new(_connectionString);
}
